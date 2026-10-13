-- League setting: auto-scoring on (the default) or off.
-- Off hides the auto-scoring card on the Game tab and the "castaways already went home" question
-- before the draft; the league then scores everything by hand. Changed in Admin > Scoring by the
-- league owner (the existing "League owners can update their league" policy covers it).
-- Adds a column with a default; changes no existing rows' data. Safe to run twice.
ALTER TABLE public.leagues ADD COLUMN IF NOT EXISTS auto_scoring boolean NOT NULL DEFAULT true;
