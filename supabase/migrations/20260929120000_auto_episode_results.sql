-- Automatic episode results (2026-09-29)
-- The sync-episode-results edge function reads the Survivor Wiki and Wikipedia every hour and
-- publishes an episode's results when the sources agree and have been steady. This adds the
-- tables it keeps its notes in, marks which results came from it, and schedules it.
-- Run AFTER 20260929090000_episode_results.sql. Safe to run more than once. Changes no rows.

ALTER TABLE public.episode_results ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.episode_results ADD COLUMN IF NOT EXISTS auto_note text;

-- What each source said about each episode, and when that answer first appeared (for "steady for N hours")
CREATE TABLE IF NOT EXISTS public.episode_result_candidates (
  season integer NOT NULL,
  source text NOT NULL CHECK (source IN ('survivor_wiki', 'wikipedia')),
  episode integer NOT NULL,
  hash text NOT NULL,
  facts jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, source, episode)
);

-- Last page read per source, so the AI is only asked again when the page's tables change
CREATE TABLE IF NOT EXISTS public.episode_sync_state (
  season integer NOT NULL,
  source text NOT NULL,
  content_hash text NOT NULL,
  raw jsonb NOT NULL DEFAULT '[]',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, source)
);

-- One row per run, shown in Site admin > Episodes
CREATE TABLE IF NOT EXISTS public.episode_sync_log (
  id bigserial PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL DEFAULT true,
  summary text,
  details jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS episode_sync_log_ran_at_idx ON public.episode_sync_log (ran_at DESC);

-- Only the edge function (service role, which bypasses RLS) writes these; only the site owner reads them
ALTER TABLE public.episode_result_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.episode_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Site owner reads candidates" ON public.episode_result_candidates;
CREATE POLICY "Site owner reads candidates" ON public.episode_result_candidates FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Site owner reads sync state" ON public.episode_sync_state;
CREATE POLICY "Site owner reads sync state" ON public.episode_sync_state FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));
DROP POLICY IF EXISTS "Site owner reads sync log" ON public.episode_sync_log;
CREATE POLICY "Site owner reads sync log" ON public.episode_sync_log FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()));

GRANT SELECT ON public.episode_result_candidates, public.episode_sync_state, public.episode_sync_log TO authenticated;

-- Hourly schedule (at :07). The function throttles itself and only asks the AI when a page changed.
-- Uses the public (anon) key, which is already in every visitor's browser.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sync-episode-results';
  PERFORM cron.schedule(
    'sync-episode-results',
    '7 * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://tcdlhmojircjhwqmvila.supabase.co/functions/v1/sync-episode-results',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRjZGxobW9qaXJjamh3cW12aWxhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMzQ4NDksImV4cCI6MjA4MjYxMDg0OX0.Y_6R-1zyv1Tzs4G8f8p_dpZGdsrpGhAetXONr0PNeU4'
      ),
      body := '{}'::jsonb
    );
    $job$
  );
END
$$;
