-- Episode results v1 (auto-scoring), 2026-09-29
-- The site owner enters the big facts of each episode once (who left, immunity, merge, jury,
-- finale). Commissioners then tap "Apply" and the app adds the matching scoring events to
-- their league in one transaction, skipping anything already entered.
-- Adds two tables and two functions. Safe to run more than once. Changes no existing rows.

-- 1) One row per season + episode, written by the site owner
CREATE TABLE IF NOT EXISTS public.episode_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  episode integer NOT NULL CHECK (episode >= 1),
  voted_out text[] NOT NULL DEFAULT '{}',
  quit text[] NOT NULL DEFAULT '{}',
  left_game text[] NOT NULL DEFAULT '{}',   -- medevac / removed: out, but no Quit penalty
  immunity text[] NOT NULL DEFAULT '{}',
  post_merge boolean NOT NULL DEFAULT false,
  jury_starts boolean NOT NULL DEFAULT false,
  final_tribal text[] NOT NULL DEFAULT '{}',
  winner text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (season, episode)
);
ALTER TABLE public.episode_results ADD COLUMN IF NOT EXISTS left_game text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.episode_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed-in users read published episode results" ON public.episode_results;
CREATE POLICY "Signed-in users read published episode results"
  ON public.episode_results FOR SELECT TO authenticated
  USING (status = 'published' OR public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Site owner manages episode results" ON public.episode_results;
CREATE POLICY "Site owner manages episode results"
  ON public.episode_results FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

GRANT SELECT, INSERT, UPDATE ON public.episode_results TO authenticated;

-- 2) Which leagues applied (or took no points for) which episode, and exactly what was added (for undo)
CREATE TABLE IF NOT EXISTS public.episode_result_applications (
  session_id uuid NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  episode integer NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season integer NOT NULL,
  events_added integer NOT NULL DEFAULT 0,
  event_ids uuid[] NOT NULL DEFAULT '{}',
  eliminated_ids uuid[] NOT NULL DEFAULT '{}',
  skipped boolean NOT NULL DEFAULT false,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, episode)
);
ALTER TABLE public.episode_result_applications ADD COLUMN IF NOT EXISTS event_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE public.episode_result_applications ADD COLUMN IF NOT EXISTS eliminated_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE public.episode_result_applications ENABLE ROW LEVEL SECURITY;

-- Commissioner of this league (or the site owner), and the session really belongs to the league
CREATE OR REPLACE FUNCTION public.is_league_commissioner(_user_id uuid, _league_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_super_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.leagues l WHERE l.id = _league_id AND l.owner_id = _user_id)
      OR EXISTS (SELECT 1 FROM public.league_memberships m
                 WHERE m.league_id = _league_id AND m.user_id = _user_id AND m.role = 'league_admin')
$$;

DROP POLICY IF EXISTS "League members read their applications" ON public.episode_result_applications;
CREATE POLICY "League members read their applications"
  ON public.episode_result_applications FOR SELECT TO authenticated
  USING (public.is_session_league_member(auth.uid(), session_id));

DROP POLICY IF EXISTS "League members record applications" ON public.episode_result_applications;
DROP POLICY IF EXISTS "Commissioners record applications" ON public.episode_result_applications;
CREATE POLICY "Commissioners record applications"
  ON public.episode_result_applications FOR INSERT TO authenticated
  WITH CHECK (
    public.is_league_commissioner(auth.uid(), league_id)
    AND EXISTS (SELECT 1 FROM public.game_sessions gs WHERE gs.id = session_id AND gs.league_id = episode_result_applications.league_id)
  );

DROP POLICY IF EXISTS "Commissioners update applications" ON public.episode_result_applications;
CREATE POLICY "Commissioners update applications"
  ON public.episode_result_applications FOR UPDATE TO authenticated
  USING (public.is_league_commissioner(auth.uid(), league_id))
  WITH CHECK (public.is_league_commissioner(auth.uid(), league_id));

DROP POLICY IF EXISTS "Commissioners undo applications" ON public.episode_result_applications;
CREATE POLICY "Commissioners undo applications"
  ON public.episode_result_applications FOR DELETE TO authenticated
  USING (public.is_league_commissioner(auth.uid(), league_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_result_applications TO authenticated;

-- 3) Apply one episode in one transaction. Claims the episode first, so a second tap (or a
--    second commissioner) fails with a unique violation instead of adding points twice.
--    SECURITY INVOKER: the caller's normal permissions apply to every table touched.
CREATE OR REPLACE FUNCTION public.apply_episode_results(
  _session_id uuid,
  _episode integer,
  _events jsonb,
  _eliminate uuid[],
  _post_merge boolean,
  _skipped boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _league_id uuid;
  _season integer;
  _ids uuid[] := '{}';
  _out uuid[] := '{}';
BEGIN
  SELECT league_id, season INTO _league_id, _season FROM public.game_sessions WHERE id = _session_id;
  IF _league_id IS NULL THEN
    RAISE EXCEPTION 'Season not found';
  END IF;

  INSERT INTO public.episode_result_applications (session_id, episode, league_id, season, skipped, applied_by)
  VALUES (_session_id, _episode, _league_id, _season, COALESCE(_skipped, false), auth.uid());

  -- Who left is always recorded, even when the league takes no points for this episode
  -- (for example, a league that started after it aired)
  WITH upd AS (
    UPDATE public.contestants
       SET is_eliminated = true
     WHERE session_id = _session_id
       AND id = ANY(COALESCE(_eliminate, '{}'))
       AND is_eliminated = false
    RETURNING id
  )
  SELECT COALESCE(array_agg(id), '{}') INTO _out FROM upd;

  -- Scored: the league sits on this episode (for manual extras). No points: it moves to the next one.
  UPDATE public.game_sessions
     SET episode = GREATEST(episode, _episode + CASE WHEN COALESCE(_skipped, false) THEN 1 ELSE 0 END),
         is_post_merge = is_post_merge OR COALESCE(_post_merge, false)
   WHERE id = _session_id;

  -- Points only when the league is scoring this episode
  IF NOT COALESCE(_skipped, false) THEN
    WITH ins AS (
      INSERT INTO public.scoring_events (session_id, contestant_id, contestant_name, action, points, episode, created_at)
      SELECT _session_id,
             (e->>'contestant_id')::uuid,
             e->>'contestant_name',
             e->>'action',
             (e->>'points')::integer,
             _episode,
             clock_timestamp()
      FROM jsonb_array_elements(COALESCE(_events, '[]'::jsonb)) AS e
      RETURNING id
    )
    SELECT COALESCE(array_agg(id), '{}') INTO _ids FROM ins;

    -- The finale: the Sole Survivor event finishes the season
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(_events, '[]'::jsonb)) AS e
               WHERE e->>'action' ILIKE '%Win Survivor%') THEN
      UPDATE public.game_sessions SET status = 'completed' WHERE id = _session_id;
    END IF;
  END IF;

  UPDATE public.episode_result_applications
     SET events_added = COALESCE(array_length(_ids, 1), 0),
         event_ids = _ids,
         eliminated_ids = _out
   WHERE session_id = _session_id AND episode = _episode;

  RETURN COALESCE(array_length(_ids, 1), 0);
END;
$$;

-- 4) Undo one episode's auto-scoring: removes exactly the events it added, brings back the
--    castaways it marked out, and clears the record so the card can be applied again.
CREATE OR REPLACE FUNCTION public.undo_episode_results(_session_id uuid, _episode integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _app public.episode_result_applications%ROWTYPE;
  _n integer := 0;
BEGIN
  SELECT * INTO _app FROM public.episode_result_applications
   WHERE session_id = _session_id AND episode = _episode
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  DELETE FROM public.scoring_events WHERE session_id = _session_id AND id = ANY(_app.event_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.contestants SET is_eliminated = false
   WHERE session_id = _session_id AND id = ANY(_app.eliminated_ids);

  -- Undoing the finale reopens the season (only if no Sole Survivor is left on the board)
  UPDATE public.game_sessions SET status = 'active'
   WHERE id = _session_id AND status = 'completed'
     AND NOT EXISTS (SELECT 1 FROM public.scoring_events
                      WHERE session_id = _session_id AND action ILIKE '%Win Survivor%');

  DELETE FROM public.episode_result_applications WHERE session_id = _session_id AND episode = _episode;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_league_commissioner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_results(uuid, integer, jsonb, uuid[], boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.undo_episode_results(uuid, integer) TO authenticated;
