import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "@/components/ConfirmHost";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import type { Contestant, ScoringEvent } from "@/types/survivor";
import type { ScoringConfig } from "@/lib/scoring";
import { askIfEpisodeCounts, pendingEpisodes, planStartedAfter, type EpisodeResult } from "@/lib/episodeResults";
import { draftPoolSize } from "@/lib/picksPerTeam";
import { useLeagueEpisodeResults, type Application } from "@/hooks/useEpisodeResults";

type OnApply = (episode: number, events: never[], eliminateIds: string[], postMerge: boolean, skipped?: boolean) => Promise<number>;

const NOT_IN_LEAGUE = "__none__";
const range = (eps: number[]) =>
  eps.length === 1 ? `episode ${eps[0]}` : `episodes ${Math.min(...eps)}–${Math.max(...eps)}`;

/**
 * Skipped episodes saved together in one answer ("take them out before the draft"), newest first,
 * so they're undone together. Episodes skipped one at a time on the card are undone one at a time.
 */
export function skippedRun(applications: Map<number, Application>): Application[] {
  const out: Application[] = [];
  let newestAt = 0;
  for (const a of [...applications.values()].sort((x, y) => y.episode - x.episode)) {
    if (!a.skipped) break;
    const at = Date.parse(a.applied_at) || 0;
    if (out.length === 0) newestAt = at;
    else if (Math.abs(newestAt - at) > 60_000) break; // saved separately
    out.push(a);
  }
  return out;
}

/** Undo a whole "we started with episode K" answer, newest episode first. */
export async function undoSkippedRun(run: Application[], onUndo: (episode: number) => Promise<number>) {
  for (const a of run) await onUndo(a.episode);
}

/**
 * Before the draft: "N castaways already went home. Take them out before you draft?"
 * Taking them out records the aired episodes as skipped (no points, castaways marked out), so the
 * league starts scoring with the next episode. Keeping everyone just closes the question; after
 * the draft each episode shows up on the auto-scoring card to add or skip.
 */
function TakeOutBeforeDraft({
  results,
  handled,
  contestants,
  scoringEvents,
  scoringConfig,
  onApply,
  refresh,
  onKeepEveryone,
  explicitPicks,
  teamCount,
  onAnswered,
}: {
  results: EpisodeResult[];
  handled: Set<number>;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null;
  onApply: OnApply;
  refresh: () => Promise<void>;
  onKeepEveryone: () => void;
  explicitPicks?: number | null;
  teamCount?: number;
  onAnswered?: (start: number) => void;
}) {
  const pending = useMemo(() => pendingEpisodes(results, handled), [results, handled]);
  const last = pending[pending.length - 1];
  const startWith = last + 1;
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () =>
      pending.length
        ? planStartedAfter({ published: results, handled, startEpisode: startWith, contestants, scoringEvents, scoringConfig, overrides })
        : null,
    [pending.length, results, handled, startWith, contestants, scoringEvents, scoringConfig, overrides]
  );
  if (!pending.length || !plan) return null;

  const needsPicks = plan.unmatchedExits.filter((n) => !(n in overrides));
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const pickable = [
    ...contestants.filter((c) => !c.isEliminated).sort(byName),
    ...contestants.filter((c) => c.isEliminated).sort(byName),
  ];
  const out = plan.goingHome;
  const eps = plan.steps.map((s) => s.episode);

  const takeOut = async () => {
    if (needsPicks.length) return;
    const poolAfter = draftPoolSize(contestants) - out;
    const tooMany =
      explicitPicks && teamCount && explicitPicks * teamCount > poolAfter
        ? ` Your league is set to ${explicitPicks} picks per team, which needs ${explicitPicks * teamCount} castaways; ${poolAfter} will be left. Lower it in the Admin tab before drafting.`
        : "";
    const ok = await confirmDialog({
      title: `Take ${out} castaway${out === 1 ? "" : "s"} out of the draft?`,
      description: `Your league starts scoring with episode ${startWith}. No points for ${range(eps)}. You can undo this until someone drafts.${tooMany}`,
      confirmText: "Take them out",
    });
    if (!ok) return;
    setBusy(true);
    let done = 0;
    try {
      for (const s of plan.steps) {
        await onApply(s.episode, [], s.eliminate, s.postMerge, true);
        done++;
      }
      await refresh();
      onAnswered?.(startWith);
      toast.success(`${out} castaway${out === 1 ? "" : "s"} taken out of the draft. Scoring starts with episode ${startWith}.`);
    } catch (err: any) {
      await refresh();
      if (err?.code === "23505") toast.info("Another commissioner already answered this.");
      else
        toast.error(
          done > 0
            ? `Saved ${done} of ${eps.length} episodes, then: ${err?.message || "an error"}. Tap "Take them out" again to finish.`
            : `Couldn't save: ${err?.message || "try again"}`
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {plan.unmatchedExits.length > 0 && (
        <div className="space-y-3 rounded-[12px] border-2 border-accent bg-accent/10 p-3">
          <p className="text-sm font-bold">
            We couldn't find {plan.unmatchedExits.length === 1 ? "this castaway" : "these castaways"} in your league's cast.
            Pick who it is so they're taken out:
          </p>
          {plan.unmatchedExits.map((name, i) => (
            <div key={name} className="space-y-1">
              <label htmlFor={`se-pick-${i}`} className="text-sm font-semibold">
                {name}
              </label>
              <select
                id={`se-pick-${i}`}
                value={overrides[name] === "" ? NOT_IN_LEAGUE : overrides[name] ?? ""}
                onChange={(e) => setOverrides((o) => ({ ...o, [name]: e.target.value === NOT_IN_LEAGUE ? "" : e.target.value }))}
                className="flex h-11 w-full max-w-sm rounded-[10px] border-2 border-input bg-card px-3 text-sm font-semibold"
              >
                <option value="" disabled>
                  Choose a castaway
                </option>
                {pickable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isEliminated ? " (already out)" : ""}
                  </option>
                ))}
                <option value={NOT_IN_LEAGUE}>Not in my league</option>
              </select>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button variant="accent" className="h-11" onClick={takeOut} disabled={busy || needsPicks.length > 0}>
          {busy ? "Saving…" : needsPicks.length > 0 ? "Pick the castaway above" : "Take them out"}
        </Button>
        <Button variant="outline" className="h-11" onClick={onKeepEveryone} disabled={busy}>
          Keep everyone
        </Button>
      </div>
    </div>
  );
}

/**
 * Before the draft, for commissioners: if episodes have already aired, ask which one the league
 * starts with, so castaways who already went home aren't drafted.
 */
export function LateStartCard({
  season,
  sessionId,
  contestants,
  scoringEvents,
  scoringConfig,
  onApply,
  onUndo,
  explicitPicks,
  teamCount,
}: {
  season: number;
  sessionId?: string;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null;
  onApply: OnApply;
  onUndo: (episode: number) => Promise<number>;
  explicitPicks?: number | null;
  teamCount?: number;
}) {
  const { results, applications, ok, refresh } = useLeagueEpisodeResults(season, sessionId);
  const key = `sr-late-start-${sessionId}`;
  const [dismissed, setDismissedState] = useState(() => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  });
  // Remembered per browser so the question doesn't come back after it's answered
  const setDismissed = (v: boolean) => {
    try {
      if (v) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      // private window: it just shows again next time
    }
    setDismissedState(v);
  };
  const [busy, setBusy] = useState(false);
  const handled = useMemo(() => new Set(applications.keys()), [applications]);
  const pending = useMemo(() => pendingEpisodes(results, handled), [results, handled]);

  if (!ok || contestants.length === 0 || contestants.some((c) => c.owner)) return null;

  // Still asking: nothing answered yet, or an answer that didn't finish (an episode that was
  // already out when they answered is still waiting)
  const asking =
    pending.length > 0 &&
    askIfEpisodeCounts({
      applications: [...applications.values()],
      publishedAt: results.find((r) => r.episode === pending[0])?.published_at,
    }) &&
    !dismissed;

  // Already answered: show it, with an undo while nobody has drafted yet
  if (applications.size > 0 && !asking) {
    const run = skippedRun(applications);
    if (!run.length || run.length !== applications.size) return null;
    const out = contestants.filter((c) => c.isEliminated).length;
    const startWith = Math.max(...run.map((a) => a.episode)) + 1;
    const undo = async () => {
      if (
        !(await confirmDialog({
          title: "Put them back in the draft?",
          description: "Castaways taken out of the draft come back, and the aired episodes return to the auto-scoring card.",
          confirmText: "Undo",
        }))
      )
        return;
      setBusy(true);
      try {
        await undoSkippedRun(run, onUndo);
        setDismissed(false);
        await refresh();
        toast.success("They're back in the draft.");
      } catch (err: any) {
        await refresh();
        toast.error(`Couldn't undo: ${err?.message || "try again"}`);
      } finally {
        setBusy(false);
      }
    };
    return (
      <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
        <div className="glass rounded-[12px] flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
          <span className="tabular">
            Scoring starts with episode {startWith}. {out} castaway{out === 1 ? "" : "s"} who already went home{" "}
            {out === 1 ? "isn't" : "aren't"} in the draft.
          </span>
          <button
            type="button"
            onClick={undo}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-1.5 font-bold underline underline-offset-2"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            Undo
          </button>
        </div>
      </div>
    );
  }

  if (!asking) return null;
  const first = pending[0];
  const last = pending[pending.length - 1];

  return (
    <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
      <section className="plank overflow-hidden">
        <div className="bg-header px-5 py-4 sm:px-6">
          <p className="label-caps text-header-label">Starting mid-season?</p>
          <h2 className="font-display text-3xl leading-none mt-1">
            {pending.length === 1 ? `Episode ${first} has aired` : `Episodes ${first}–${last} have aired`}
          </h2>
          <p className="mt-2 text-sm text-header-label max-w-[60ch]">
            Some castaways have already gone home. Take them out before you draft so nobody picks someone who's gone. Your
            league then starts scoring with episode {last + 1}. Keep everyone if your league is counting from episode {first}.
          </p>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <TakeOutBeforeDraft
            results={results}
            handled={handled}
            contestants={contestants}
            scoringEvents={scoringEvents}
            scoringConfig={scoringConfig}
            onApply={onApply}
            refresh={refresh}
            explicitPicks={explicitPicks}
            teamCount={teamCount}
            onAnswered={() => setDismissed(true)}
            onKeepEveryone={() => {
              setDismissed(true);
              toast.success("Got it. After the draft, each episode shows up on the auto-scoring card to add or skip.");
            }}
          />
        </div>
      </section>
    </div>
  );
}
