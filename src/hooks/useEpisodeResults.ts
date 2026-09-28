import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EpisodeResult } from "@/lib/episodeResults";

// The episode results tables are newer than the generated Supabase types
const db = supabase as unknown as { from: (table: string) => any };

/**
 * Published episode results for a season, plus which episodes this league session has
 * already applied or skipped. Quietly returns nothing if the tables don't exist yet.
 */
export function useLeagueEpisodeResults(season: number | undefined, sessionId: string | undefined) {
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [handled, setHandled] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!season || !sessionId) return;
    const [r, a] = await Promise.all([
      db.from("episode_results").select("*").eq("season", season).eq("status", "published").order("episode"),
      db.from("episode_result_applications").select("episode").eq("session_id", sessionId),
    ]);
    if (!r.error) setResults((r.data as EpisodeResult[]) || []);
    if (!a.error) setHandled(new Set(((a.data as { episode: number }[]) || []).map((x) => x.episode)));
    setLoading(false);
  }, [season, sessionId]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const recordHandled = useCallback(
    async (args: { leagueId: string; episode: number; eventsAdded: number; skipped: boolean; userId?: string }) => {
      if (!season || !sessionId) return;
      const { error } = await db.from("episode_result_applications").insert({
        session_id: sessionId,
        league_id: args.leagueId,
        season,
        episode: args.episode,
        events_added: args.eventsAdded,
        skipped: args.skipped,
        applied_by: args.userId ?? null,
      });
      // A second commissioner may have beaten us to it; that's fine
      if (error && error.code !== "23505") throw error;
      setHandled((prev) => new Set(prev).add(args.episode));
    },
    [season, sessionId]
  );

  return { results, handled, loading, refresh, recordHandled };
}

/** All results for a season, any status. Site owner only (RLS). */
export function useAdminEpisodeResults(season: number | undefined) {
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!season) return;
    setLoading(true);
    const { data, error } = await db.from("episode_results").select("*").eq("season", season).order("episode");
    if (error) setError(error.message);
    else {
      setError(null);
      setResults((data as EpisodeResult[]) || []);
    }
    setLoading(false);
  }, [season]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(
    async (row: EpisodeResult, publish: boolean | null, userId?: string) => {
      const payload: Record<string, unknown> = {
        season: row.season,
        episode: row.episode,
        voted_out: row.voted_out,
        quit: row.quit,
        immunity: row.immunity,
        post_merge: row.post_merge,
        jury_starts: row.jury_starts,
        final_tribal: row.final_tribal,
        winner: row.winner || null,
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      };
      if (publish === true) {
        payload.status = "published";
        payload.published_at = row.published_at || new Date().toISOString();
      } else if (publish === false) {
        payload.status = "draft";
      }
      const { error } = await db.from("episode_results").upsert(payload, { onConflict: "season,episode" });
      if (error) throw error;
      await refresh();
    },
    [refresh]
  );

  return { results, loading, error, refresh, save };
}
