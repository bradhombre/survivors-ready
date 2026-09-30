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

/** The "started after" answers at the top of the league's history, newest first (undone together). */
export function skippedRun(applications: Map<number, Application>): Application[] {
  const out: Application[] = [];
  for (const a of [...applications.values()].sort((x, y) => y.episode - x.episode)) {
    if (!a.skipped) break;
    out.push(a);
  }
  return out;
}

/** Undo a whole "we started with episode K" answer, newest episode first. */
export async function undoSkippedRun(run: Application[], onUndo: (episode: number) => Promise<number>) {
  for (const a of run) await onUndo(a.episode);
}

/**
 * "Which episode did your league start with?" Episodes before the answer get no points; whoever
 * went home in them is marked out (before a draft, that takes them out of the draft pool).
 */
export function StartEpisodePicker({
  results,
  handled,
  contestants,
  scoringEvents,
  scoringConfig,
  onApply,
  refresh,
  predraft = false,
  onCountFirst,
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
  predraft?: boolean;
  /** They're counting from the first waiting episode */
  onCountFirst: () => void;
  /** Before the draft: a fixed picks-per-team setting that the smaller pool may not fit */
  explicitPicks?: number | null;
  teamCount?: number;
  /** After a "start with episode K" answer is saved */
  onAnswered?: (start: number) => void;
}) {
  const pending = useMemo(() => pendingEpisodes(results, handled), [results, handled]);
  const first = pending[0];
  const last = pending[pending.length - 1];
  const [start, setStart] = useState<number | "">("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setOverrides({}), [start]);

  const plan = useMemo(
    () =>
      typeof start === "number" && start > first
        ? planStartedAfter({ published: results, handled, startEpisode: start, contestants, scoringEvents, scoringConfig, overrides })
        : null,
    [start, first, results, handled, contestants, scoringEvents, scoringConfig, overrides]
  );
  if (!pending.length) return null;

  const needsPicks = plan ? plan.unmatchedExits.filter((n) => !(n in overrides)) : [];
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const pickable = [
    ...contestants.filter((c) => !c.isEliminated).sort(byName),
    ...contestants.filter((c) => c.isEliminated).sort(byName),
  ];
  const options = [...pending, last + 1];
  const label = (k: number) => {
    if (k === last + 1) return `Episode ${k}, the next one to air${predraft ? "" : " (count none of these)"}`;
    if (k === first) return predraft ? `Episode ${k} (from the start)` : pending.length === 1 ? `Episode ${k} (count it)` : `Episode ${k} (count all ${pending.length})`;
    return predraft ? `Episode ${k}` : `Episode ${k} (count ${last - k + 1})`;
  };

  const go = async () => {
    if (start === "") return;
    if (start === first) return onCountFirst();
    if (!plan || needsPicks.length) return;
    const eps = plan.steps.map((s) => s.episode);
    const out = plan.goingHome;
    const poolAfter = draftPoolSize(contestants) - out;
    const tooMany =
      predraft && explicitPicks && teamCount && explicitPicks * teamCount > poolAfter
        ? ` Your league is set to ${explicitPicks} picks per team, which needs ${explicitPicks * teamCount} castaways; ${poolAfter} will be left. Lower it in the Admin tab before drafting.`
        : "";
    const ok = await confirmDialog({
      title: `Start with episode ${start}?`,
      description:
        `No points for ${range(eps)}. ` +
        (out > 0
          ? `The ${out} castaway${out === 1 ? "" : "s"} who went home in ${eps.length === 1 ? "it" : "them"} ${out === 1 ? "is" : "are"} ${
              predraft ? "taken out of the draft" : "marked out"
            }. `
          : "") +
        "You can undo this for 2 days." +
        tooMany,
      confirmText: `Start with episode ${start}`,
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
      onAnswered?.(start);
      toast.success(
        predraft
          ? `Starting with episode ${start}. ${out} castaway${out === 1 ? "" : "s"} taken out of the draft.`
          : `Starting with episode ${start}. No points for ${range(eps)}.`
      );
    } catch (err: any) {
      await refresh();
      if (err?.code === "23505") toast.info("Another commissioner already answered this.");
      else
        toast.error(
          done > 0
            ? `Saved ${done} of ${eps.length} episodes, then: ${err?.message || "an error"}. Pick episode ${start} again to finish.`
            : `Couldn't save: ${err?.message || "try again"}`
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="start-episode" className="label-caps text-muted-foreground">
          Our league's first episode
        </label>
        <select
          id="start-episode"
          value={start}
          onChange={(e) => setStart(e.target.value ? Number(e.target.value) : "")}
          className="flex h-11 w-full max-w-sm rounded-[10px] border-2 border-input bg-card px-3 text-sm font-semibold"
        >
          <option value="">Choose an episode</option>
          {options.map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </select>
      </div>

      {plan && plan.unmatchedExits.length > 0 && (
        <div className="space-y-3 rounded-[12px] border-2 border-accent bg-accent/10 p-3">
          <p className="text-sm font-bold">
            We couldn't find {plan.unmatchedExits.length === 1 ? "this castaway" : "these castaways"} in your league's cast.
            Pick who it is so they're marked out:
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

      <Button variant="accent" className="h-11" onClick={go} disabled={busy || start === "" || needsPicks.length > 0}>
        {busy ? "Saving…" : needsPicks.length > 0 ? "Pick the castaway above" : "Continue"}
      </Button>
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
          title: `Undo "starting with episode ${startWith}"?`,
          description: "Castaways taken out of the draft come back.",
          confirmText: "Undo",
        }))
      )
        return;
      setBusy(true);
      try {
        await undoSkippedRun(run, onUndo);
        setDismissed(false);
        await refresh();
        toast.success("Undone. Pick your first episode again.");
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
            Your league starts with episode {startWith}. {out} castaway{out === 1 ? "" : "s"} who already went home{" "}
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
            If your league starts later, pick your first episode before you draft. Everyone who already went home is taken
            out of the draft, and earlier episodes get no points.
          </p>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <StartEpisodePicker
            predraft
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
            onCountFirst={() => {
              setDismissed(true);
              toast.success("Got it. After the draft you'll get to count each episode.");
            }}
          />
        </div>
      </section>
    </div>
  );
}
