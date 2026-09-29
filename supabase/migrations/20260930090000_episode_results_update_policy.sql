-- Episode results: tighten who can edit an "episode applied" record (2026-09-30)
-- Adding a record already checks that the season belongs to the commissioner's league. Editing
-- one didn't, so a commissioner could move their record onto another league's season and block
-- that league from applying the episode. Same check now applies to edits.
-- Changes no rows. Safe to run more than once.

DROP POLICY IF EXISTS "Commissioners update applications" ON public.episode_result_applications;
CREATE POLICY "Commissioners update applications"
  ON public.episode_result_applications FOR UPDATE TO authenticated
  USING (public.is_league_commissioner(auth.uid(), league_id))
  WITH CHECK (
    public.is_league_commissioner(auth.uid(), league_id)
    AND EXISTS (
      SELECT 1 FROM public.game_sessions gs
      WHERE gs.id = session_id AND gs.league_id = episode_result_applications.league_id
    )
  );
