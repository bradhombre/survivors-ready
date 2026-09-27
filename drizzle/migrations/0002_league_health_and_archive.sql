-- League health + archive (2026-09-27)
--
-- Why: "Last activity" in Site admin was misleading. JeffBot messages counted as activity, so the
-- 9/25 "Season 51 is here!" post (sent to 301 league chats) made 297 of 307 leagues look active that day.
-- Draft picks and people joining a league didn't count at all.
--
-- This migration:
--   1. Counts only things people do: chat from a person (not JeffBot), scoring, draft picks,
--      someone joining, a new season starting, episode/mode changes.
--   2. Recalculates last_activity_at for every league from that real history.
--   3. Adds leagues.archived_at. Archiving is a Site admin label only: players never see it,
--      nothing is deleted, and any real activity in the league clears it automatically.
--   4. Adds admin_league_health(): one row per league with its stage (Playing, Needs players, ...).
--   5. Adds admin_set_league_archived(): archive or unarchive a set of leagues.
-- Both functions only work for the site owner. Safe to run more than once. Deletes nothing.

-- 1) Archive column
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- 2) Real activity only
CREATE OR REPLACE FUNCTION public.update_league_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _league_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'chat_messages' THEN
    IF COALESCE(NEW.is_bot, false) THEN
      RETURN NEW;  -- JeffBot posts are not league activity
    END IF;
    _league_id := NEW.league_id;
  ELSIF TG_TABLE_NAME = 'scoring_events' THEN
    SELECT league_id INTO _league_id FROM public.game_sessions WHERE id = NEW.session_id;
  ELSIF TG_TABLE_NAME = 'game_sessions' THEN
    _league_id := NEW.league_id;
  ELSIF TG_TABLE_NAME = 'contestants' THEN
    SELECT league_id INTO _league_id FROM public.game_sessions WHERE id = NEW.session_id;
  ELSIF TG_TABLE_NAME = 'league_memberships' THEN
    _league_id := NEW.league_id;
  END IF;

  IF _league_id IS NOT NULL THEN
    UPDATE public.leagues
       SET last_activity_at = now(),
           archived_at = NULL          -- a league that comes back to life leaves the archive
     WHERE id = _league_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- Existing triggers (chat insert, scoring insert, session mode/episode update) keep using the function above.
-- New: a season starting, a draft pick (or undo), someone joining.
DROP TRIGGER IF EXISTS trg_session_created_activity ON public.game_sessions;
CREATE TRIGGER trg_session_created_activity
  AFTER INSERT ON public.game_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_league_activity();

DROP TRIGGER IF EXISTS trg_pick_activity ON public.contestants;
CREATE TRIGGER trg_pick_activity
  AFTER UPDATE OF owner ON public.contestants
  FOR EACH ROW
  WHEN (OLD.owner IS DISTINCT FROM NEW.owner)
  EXECUTE FUNCTION public.update_league_activity();

DROP TRIGGER IF EXISTS trg_join_activity ON public.league_memberships;
CREATE TRIGGER trg_join_activity
  AFTER INSERT ON public.league_memberships
  FOR EACH ROW EXECUTE FUNCTION public.update_league_activity();

-- 3) Recalculate last_activity_at from real history (overwrites the 9/25 JeffBot bump).
--    Draft picks have no timestamp of their own; game_sessions.updated_at moves with every pick,
--    so it stands in for them here.
UPDATE public.leagues l
   SET last_activity_at = r.real_last
  FROM (
    SELECT l2.id,
      GREATEST(
        l2.created_at,
        (SELECT max(c.created_at) FROM public.chat_messages c WHERE c.league_id = l2.id AND NOT COALESCE(c.is_bot, false)),
        (SELECT max(e.created_at) FROM public.scoring_events e JOIN public.game_sessions g ON g.id = e.session_id WHERE g.league_id = l2.id),
        (SELECT max(GREATEST(g.created_at, g.updated_at)) FROM public.game_sessions g WHERE g.league_id = l2.id),
        (SELECT max(m.joined_at) FROM public.league_memberships m WHERE m.league_id = l2.id AND m.user_id <> l2.owner_id)
      ) AS real_last
    FROM public.leagues l2
  ) r
 WHERE r.id = l.id
   AND r.real_last IS DISTINCT FROM l.last_activity_at;

-- 4) One row per league, with its stage. Site owner only.
DROP FUNCTION IF EXISTS public.admin_league_health();
CREATE FUNCTION public.admin_league_health()
RETURNS TABLE (
  id uuid,
  name text,
  owner_id uuid,
  owner_email text,
  created_at timestamptz,
  archived_at timestamptz,
  last_activity_at timestamptz,
  last_member_sign_in timestamptz,
  member_count int,
  season int,
  episode int,
  game_type text,
  mode text,
  cast_count int,
  drafted_count int,
  season_scoring_events int,
  scored_episodes int,
  ever_scored boolean,
  ever_drafted boolean,
  current_season int,
  stage text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _cur int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the site owner can see league health';
  END IF;

  SELECT substring(value from '\d{1,4}')::int INTO _cur
    FROM public.app_settings WHERE key = 'current_season';

  RETURN QUERY
  WITH cur AS (
    SELECT DISTINCT ON (g.league_id) g.id AS sid, g.league_id, g.season, g.episode, g.game_type, g.mode
      FROM public.game_sessions g
     ORDER BY g.league_id, g.created_at DESC
  ),
  base AS (
    SELECT
      l.id, l.name, l.owner_id, p.email AS owner_email, l.created_at, l.archived_at, l.last_activity_at,
      (SELECT max(u.last_sign_in_at) FROM public.league_memberships m JOIN auth.users u ON u.id = m.user_id
        WHERE m.league_id = l.id) AS last_member_sign_in,
      (SELECT count(*) FROM public.league_memberships m WHERE m.league_id = l.id)::int AS member_count,
      cur.season, cur.episode, cur.game_type, cur.mode,
      (SELECT count(*) FROM public.contestants c WHERE c.session_id = cur.sid)::int AS cast_count,
      (SELECT count(*) FROM public.contestants c WHERE c.session_id = cur.sid AND c.owner IS NOT NULL)::int AS drafted_count,
      (SELECT count(*) FROM public.scoring_events e WHERE e.session_id = cur.sid)::int AS season_scoring_events,
      (SELECT count(DISTINCT e.episode) FROM public.scoring_events e WHERE e.session_id = cur.sid)::int AS scored_episodes,
      EXISTS (SELECT 1 FROM public.scoring_events e JOIN public.game_sessions g ON g.id = e.session_id
               WHERE g.league_id = l.id) AS ever_scored,
      EXISTS (SELECT 1 FROM public.contestants c JOIN public.game_sessions g ON g.id = c.session_id
               WHERE g.league_id = l.id AND c.owner IS NOT NULL) AS ever_drafted
    FROM public.leagues l
    LEFT JOIN cur ON cur.league_id = l.id
    LEFT JOIN public.profiles p ON p.id = l.owner_id
  )
  SELECT
    b.id, b.name, b.owner_id, b.owner_email, b.created_at, b.archived_at, b.last_activity_at,
    b.last_member_sign_in, b.member_count, b.season, b.episode, b.game_type, b.mode,
    b.cast_count, b.drafted_count, b.season_scoring_events, b.scored_episodes,
    b.ever_scored, b.ever_drafted, _cur,
    CASE
      WHEN b.season = _cur AND b.season_scoring_events > 0
           AND b.last_activity_at > now() - interval '14 days'   THEN 'playing'
      WHEN b.season = _cur AND b.season_scoring_events > 0       THEN 'stopped_scoring'
      WHEN b.season = _cur AND b.drafted_count > 0               THEN 'needs_scoring'
      WHEN b.season = _cur AND b.member_count > 1                THEN 'ready_to_draft'
      WHEN b.season = _cur                                       THEN 'needs_players'
      WHEN b.ever_scored                                         THEN 'not_rolled_over'
      WHEN b.ever_drafted                                        THEN 'fizzled'
      ELSE 'never_started'
    END AS stage
  FROM base b;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_league_health() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_league_health() TO authenticated;

-- 5) Archive / unarchive. Site owner only. Returns how many leagues changed.
DROP FUNCTION IF EXISTS public.admin_set_league_archived(uuid[], boolean);
CREATE FUNCTION public.admin_set_league_archived(league_ids uuid[], archive boolean)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n int;
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only the site owner can archive leagues';
  END IF;

  UPDATE public.leagues
     SET archived_at = CASE WHEN archive THEN now() ELSE NULL END
   WHERE id = ANY(league_ids)
     AND (archived_at IS NULL) = archive;   -- only rows that actually change
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_league_archived(uuid[], boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_league_archived(uuid[], boolean) TO authenticated;