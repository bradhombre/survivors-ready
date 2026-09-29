import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { EpisodeResult } from "@/lib/episodeResults";

// The episode results tables are newer than the generated Supabase types
const db = supabase as unknown as { from: (table: string) => any };

export type Application = {
  episode: number;
  skipped: boolean;
  events_added: number;
  applied_at: string;
  /** Scoring events this apply added (so later plans can tell auto-scored from hand-entered) */
  event_ids?: string[];
};

/**
 * Published episode results for a season, plus which episodes this league session has
 * already applied or skipped. Refreshes when the app comes back to the foreground and every
 * minute while visible. If either query fails, `ok` is false and the card stays hidden.
 */
export function useLeagueEpisodeResults(season: number | undefined, sessionId: string | undefined) {
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [applications, setApplications] = useState<Map<number, Application>>(new Map());
  const [ok, setOk] = useState(false);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!season || !sessionId) return;
    const id = ++requestId.current;
    const [r, a] = await Promise.all([
      db.from("episode_results").select("*").eq("season", season).eq("status", "published").order("episode"),
      db.from("episode_result_applications").select("episode, skipped, events_added, applied_at, event_ids").eq("session_id", sessionId),
    ]);
    if (id !== requestId.current) return; // a newer refresh already landed
    if (r.error || a.error) {
      setOk(false);
      return;
    }
    setResults((r.data as EpisodeResult[]) || []);
    setApplications(new Map(((a.data as Application[]) || []).map((x) => [x.episode, x])));
    setOk(true);
  }, [season, sessionId]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { results, applications, ok, refresh };
}

/** The facts that change scoring, for "did anything actually change?" */
const factsOf = (r: EpisodeResult) =>
  JSON.stringify([
    [...r.voted_out].sort(),
    [...r.quit].sort(),
    [...(r.left_game || [])].sort(),
    [...r.immunity].sort(),
    !!r.post_merge,
    !!r.jury_starts,
    [...r.final_tribal].sort(),
    r.winner || null,
  ]);

/** All results for a season, any status. Site owner only (RLS). */
export function useAdminEpisodeResults(season: number | undefined) {
  const [results, setResults] = useState<EpisodeResult[]>([]);
  const [resultsSeason, setResultsSeason] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!season) return;
    const id = ++requestId.current;
    setLoading(true);
    const { data, error } = await db.from("episode_results").select("*").eq("season", season).order("episode");
    if (id !== requestId.current) return;
    if (error) setError(error.message);
    else {
      setError(null);
      setResults((data as EpisodeResult[]) || []);
      setResultsSeason(season);
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
        left_game: row.left_game || [],
        immunity: row.immunity,
        post_merge: row.post_merge,
        jury_starts: row.jury_starts,
        final_tribal: row.final_tribal,
        winner: row.winner || null,
        updated_by: userId ?? null,
        // Anything saved here is the site owner's call, even if the wiki job filled it in first
        source: "manual",
      };
      // updated_at marks a correction: leagues that applied the episode before it get an
      // "Update my league" button. So it only moves when the facts really changed.
      const before = results.find((r) => r.episode === row.episode);
      if (!before || factsOf(before) !== factsOf(row)) payload.updated_at = new Date().toISOString();
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
    [refresh, results]
  );

  return { results, resultsSeason, loading, error, refresh, save };
}
