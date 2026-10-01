-- Customer.io sync (2026-09-30)
-- An hourly job (edge function cio-sync) tells Customer.io what's happening in the app, from the
-- server, so emails can be based on real activity: profile attributes (leagues, commissioner,
-- league stage) and events (league created, joined, draft done, episode scored, season started,
-- signed up). It sends nothing until the site owner turns it on in Site admin > Settings.
-- The first run after turning it on only marks what already happened as sent, so nobody gets
-- events for old activity. Safe to run more than once. Changes no existing rows.

-- Events already sent (or marked sent on the first run), so nothing is ever sent twice
CREATE TABLE IF NOT EXISTS public.cio_sent_events (
  event_key text PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  sent boolean NOT NULL DEFAULT true,       -- false = marked on the first run, never actually sent
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Last attributes sent per person (only changes are sent again)
CREATE TABLE IF NOT EXISTS public.cio_person_state (
  user_id uuid PRIMARY KEY,
  attrs_hash text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- One row per run, shown in Site admin > Settings
CREATE TABLE IF NOT EXISTS public.cio_sync_log (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT false,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'
);

-- Only the edge function (service role, which bypasses RLS) writes these; only the site owner reads them
ALTER TABLE public.cio_sent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cio_person_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cio_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site owner reads sent events" ON public.cio_sent_events;
CREATE POLICY "Site owner reads sent events" ON public.cio_sent_events
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Site owner reads person state" ON public.cio_person_state;
CREATE POLICY "Site owner reads person state" ON public.cio_person_state
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Site owner reads sync log" ON public.cio_sync_log;
CREATE POLICY "Site owner reads sync log" ON public.cio_sync_log
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

GRANT SELECT ON public.cio_sent_events, public.cio_person_state, public.cio_sync_log TO authenticated;

-- League stage per league, same rules as Site admin > Leagues (admin_league_health), for the
-- sync job only (service role). Not callable from the browser.
CREATE OR REPLACE FUNCTION public.cio_league_stages()
RETURNS TABLE (league_id uuid, stage text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH settings AS (
    SELECT substring(value from '\d{1,4}')::int AS cur FROM public.app_settings WHERE key = 'current_season'
  ),
  cur AS (
    SELECT DISTINCT ON (g.league_id) g.id AS sid, g.league_id, g.season
      FROM public.game_sessions g
     ORDER BY g.league_id, g.created_at DESC
  ),
  base AS (
    SELECT
      l.id, l.last_activity_at, cur.season,
      (SELECT count(*) FROM public.league_memberships m WHERE m.league_id = l.id)::int AS member_count,
      (SELECT count(*) FROM public.contestants c WHERE c.session_id = cur.sid AND c.owner IS NOT NULL)::int AS drafted_count,
      (SELECT count(*) FROM public.scoring_events e WHERE e.session_id = cur.sid)::int AS season_scoring_events,
      EXISTS (SELECT 1 FROM public.scoring_events e JOIN public.game_sessions g ON g.id = e.session_id
               WHERE g.league_id = l.id) AS ever_scored,
      EXISTS (SELECT 1 FROM public.contestants c JOIN public.game_sessions g ON g.id = c.session_id
               WHERE g.league_id = l.id AND c.owner IS NOT NULL) AS ever_drafted
    FROM public.leagues l
    LEFT JOIN cur ON cur.league_id = l.id
  )
  SELECT b.id,
    CASE
      WHEN b.season = s.cur AND b.season_scoring_events > 0
           AND b.last_activity_at > now() - interval '14 days'   THEN 'playing'
      WHEN b.season = s.cur AND b.season_scoring_events > 0       THEN 'stopped_scoring'
      WHEN b.season = s.cur AND b.drafted_count > 0               THEN 'needs_scoring'
      WHEN b.season = s.cur AND b.member_count > 1                THEN 'ready_to_draft'
      WHEN b.season = s.cur                                       THEN 'needs_players'
      WHEN b.ever_scored                                          THEN 'not_rolled_over'
      WHEN b.ever_drafted                                         THEN 'fizzled'
      ELSE 'never_started'
    END
  FROM base b LEFT JOIN settings s ON true;
$function$;

REVOKE ALL ON FUNCTION public.cio_league_stages() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cio_league_stages() TO service_role;

-- Off until the site owner turns it on (Site admin > Settings > Customer.io sync)
INSERT INTO public.app_settings (key, value)
VALUES ('cio_sync_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

-- Hourly at :37 (the episode results job runs at :07). Uses the public (anon) key, which is
-- already in every visitor's browser; the function only sends when the setting above is on.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cio-sync';
  PERFORM cron.schedule(
    'cio-sync',
    '37 * * * *',
    $job$
      SELECT net.http_post(
        url := 'https://tcdlhmojircjhwqmvila.supabase.co/functions/v1/cio-sync',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjZGxobW9qaXJjamh3cW12aWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzQ4NDksImV4cCI6MjA4MjYxMDg0OX0.Y_6R-1zyv1Tzs4G8f8p_dpZGdsrpGhAetXONr0PNeU4"}'::jsonb,
        body := '{}'::jsonb
      );
    $job$
  );
END;
$$;
