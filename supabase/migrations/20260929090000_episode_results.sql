-- Episode results v1 (auto-scoring), 2026-09-29
-- The site owner enters the big facts of each episode once (who left, immunity, merge, jury,
-- finale). Commissioners then tap "Apply" and the app adds the matching scoring events to
-- their league, skipping anything already entered. This migration only adds two tables.
-- Safe to run more than once. Changes no existing rows.

-- 1) One row per season + episode, written by the site owner
CREATE TABLE IF NOT EXISTS public.episode_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season integer NOT NULL,
  episode integer NOT NULL CHECK (episode >= 1),
  voted_out text[] NOT NULL DEFAULT '{}',
  quit text[] NOT NULL DEFAULT '{}',
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

-- 2) Which leagues have applied (or skipped) which episode, so the card shows once per episode
CREATE TABLE IF NOT EXISTS public.episode_result_applications (
  session_id uuid NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  episode integer NOT NULL,
  league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  season integer NOT NULL,
  events_added integer NOT NULL DEFAULT 0,
  skipped boolean NOT NULL DEFAULT false,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, episode)
);

ALTER TABLE public.episode_result_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "League members read their applications" ON public.episode_result_applications;
CREATE POLICY "League members read their applications"
  ON public.episode_result_applications FOR SELECT TO authenticated
  USING (public.is_session_league_member(auth.uid(), session_id));

DROP POLICY IF EXISTS "League members record applications" ON public.episode_result_applications;
CREATE POLICY "League members record applications"
  ON public.episode_result_applications FOR INSERT TO authenticated
  WITH CHECK (public.is_session_league_member(auth.uid(), session_id));

GRANT SELECT, INSERT ON public.episode_result_applications TO authenticated;
