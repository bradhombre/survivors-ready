// Auto-scoring results card: one episode at a time (Add, Skip, or hide until the next episode).
import { useEffect, useMemo, useState } from "react";
import { confirmDialog } from "@/components/ConfirmHost";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Sparkles, Undo2, X } from "lucide-react";
import type { Contestant, ScoringEvent } from "@/types/survivor";
import type { ScoringConfig } from "@/lib/scoring";
import { buildEpisodePlan, nextPendingEpisode, pointsByTeam, type ActionKey } from "@/lib/episodeResults";
import { useLeagueEpisodeResults } from "@/hooks/useEpisodeResults";
import { skippedRun, undoSkippedRun } from "@/components/StartEpisodePicker";

/** "Aubry ×2, Joe ×2" (the finale gives finalists two survival rounds) */
const namesWithCounts = (names: string[]) =>
  [...new Set(names)]
    .map((n) => {
      const k = names.filter((x) => x === n).length;
      return k > 1 ? `${n} ×${k}` : n;
    })
    .join(", ");

type PlannedInput = { contestantId: string; contestantName: string; action: string; points: number };

interface EpisodeResultsCardProps {
  season: number;
  sessionId?: string;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null;
  onApply: (episode: number, events: PlannedInput[], eliminateIds: string[], postMerge: boolean, skipped?: boolean) => Promise<number>;
  onUndo: (episode: number) => Promise<number>;
}

const GROUPS: { key: ActionKey; label: string }[] = [
  { key: "VOTED_OUT", label: "Voted out" },
  { key: "QUIT", label: "Quit" },
  { key: "MEDEVAC", label: "Medevac or removed" },
  { key: "WIN_IMMUNITY", label: "Won individual immunity" },
  { key: "SURVIVE_PRE", label: "Survived (pre-merge)" },
  { key: "SURVIVE_POST", label: "Survived (post-merge)" },
  { key: "MAKE_JURY", label: "Made the jury" },
  { key: "MAKE_FINAL", label: "Made Final Tribal" },
  { key: "WIN_SURVIVOR", label: "Sole Survivor" },
];

const EXIT_KEYS = new Set<ActionKey>(["VOTED_OUT", "QUIT", "MEDEVAC"]);
const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));
const NOT_IN_LEAGUE = "__none__";

/**
 * Commissioner-only card: "Episode N results are in", one episode at a time, in order.
 * Add: one tap adds the big events (voted out, survived, immunity, jury, finale), skipping
 * anything already entered. Skip: no points, but whoever went home is still marked out.
 * The X hides the card until the next episode is posted (remembered on this device), so
 * leagues that watch later aren't nagged. Leagues can turn auto-scoring off in Admin > Scoring.
 */
export function EpisodeResultsCard({
  season,
  sessionId,
  contestants,
  scoringEvents,
  scoringConfig,
  onApply,
  onUndo,
}: EpisodeResultsCardProps) {
  const { results, applications, ok, refresh } = useLeagueEpisodeResults(season, sessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [howOpen, setHowOpen] = useState(false);

  // "Hide until the next episode": remembers the newest episode that was posted when hidden
  const hideKey = `sr-er-hidden-${sessionId}`;
  const newestPosted = useMemo(() => Math.max(0, ...results.map((r) => r.episode)), [results]);
  const [hiddenThrough, setHiddenThrough] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(hideKey)) || 0;
    } catch {
      return 0;
    }
  });
  const hide = () => {
    try {
      localStorage.setItem(hideKey, String(newestPosted));
    } catch {
      // private window: hidden for this visit only
    }
    setHiddenThrough(newestPosted);
  };
  const hidden = newestPosted > 0 && hiddenThrough >= newestPosted;

  const handled = useMemo(() => new Set(applications.keys()), [applications]);
  const skipped = useMemo(
    () => new Set([...applications.values()].filter((a) => a.skipped).map((a) => a.episode)),
    [applications]
  );
  const autoEventIds = useMemo(
    () => new Set([...applications.values()].flatMap((a) => a.event_ids || [])),
    [applications]
  );
  const { next, blocked, waiting } = useMemo(() => nextPendingEpisode(results, handled), [results, handled]);

  // Picks for names we couldn't match belong to one episode. If the episode on the card changes
  // (another commissioner applied it), close the review so it never shows a different episode.
  useEffect(() => {
    setOverrides({});
    setOpen(false);
  }, [next]);

  const plan = useMemo(
    () =>
      next !== undefined
        ? buildEpisodePlan({ published: results, episode: next, contestants, scoringEvents, scoringConfig, overrides, skipped, autoEventIds })
        : null,
    [next, results, contestants, scoringEvents, scoringConfig, overrides, skipped, autoEventIds]
  );

  // Most recent episode handled here (scored, marked done, or "we started after it"), for the undo line (2 days)
  const lastApplied = useMemo(() => {
    const recent = [...applications.values()]
      .filter((a) => Date.now() - Date.parse(a.applied_at) < 2 * 864e5)
      .sort((a, b) => b.episode - a.episode);
    return recent[0];
  }, [applications]);

  // Results the site owner corrected after this league applied them (oldest first)
  const corrected = useMemo(() => {
    const eps = [...applications.values()]
      .filter((a) => {
        const r = results.find((x) => x.episode === a.episode);
        return !a.skipped && r?.updated_at && Date.parse(r.updated_at) > Date.parse(a.applied_at);
      })
      .map((a) => a.episode)
      .sort((a, b) => a - b);
    return eps[0];
  }, [applications, results]);

  // Episodes skipped together before the draft ("take them out"), undone together
  const run = skippedRun(applications);

  if (!ok) return null;

  const undo = async (episode: number) => {
    const wasSkipped = applications.get(episode)?.skipped;
    // Undoing a "started after" answer undoes the whole answer (all the episodes it covered)
    const eps = wasSkipped && run.some((a) => a.episode === episode) ? run.map((a) => a.episode) : [episode];
    const span = eps.length === 1 ? `episode ${eps[0]}` : `episodes ${Math.min(...eps)}–${Math.max(...eps)}`;
    const ok = await confirmDialog(
      wasSkipped
        ? {
            title: `Undo skipping ${span}?`,
            description: `${eps.length === 1 ? "It comes" : "They come"} back on the card so you can add the points or skip again.`,
            confirmText: "Undo",
          }
        : {
            title: `Undo episode ${episode} auto-scoring?`,
            description: "The points it added are removed and castaways it marked out come back.",
            confirmText: "Undo",
            destructive: true,
          }
    );
    if (!ok) return;
    setBusy(true);
    try {
      let n = 0;
      if (wasSkipped) await undoSkippedRun(run.filter((a) => eps.includes(a.episode)), onUndo);
      else n = await onUndo(episode);
      await refresh();
      toast.success(wasSkipped ? `${span[0].toUpperCase()}${span.slice(1)} ${eps.length === 1 ? "is" : "are"} back on the card` : `Episode ${episode} auto-scoring undone (${n} ${n === 1 ? "event" : "events"} removed)`);
    } catch (err: any) {
      toast.error(`Couldn't undo: ${err?.message || "try again"}`);
    } finally {
      setBusy(false);
    }
  };

  const undoLine = lastApplied && !open && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6 text-sm text-muted-foreground border-t-2 border-border">
      <span className="tabular">
        {lastApplied.skipped
          ? run.length > 1 && run.some((a) => a.episode === lastApplied.episode)
            ? `Episodes ${Math.min(...run.map((a) => a.episode))}–${lastApplied.episode} skipped: no points.`
            : `Episode ${lastApplied.episode} skipped: no points.`
          : lastApplied.events_added > 0
          ? `Episode ${lastApplied.episode} was auto-scored (${lastApplied.events_added} ${lastApplied.events_added === 1 ? "event" : "events"}).`
          : `Episode ${lastApplied.episode} was already scored, so nothing new was added.`}
      </span>
      <button
        type="button"
        onClick={() => undo(lastApplied.episode)}
        disabled={busy}
        className="inline-flex min-h-[40px] items-center gap-1.5 font-bold text-foreground underline underline-offset-2"
      >
        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
        Undo
      </button>
    </div>
  );

  // A correction reaches this league only when the commissioner says so: the episode (and any
  // applied after it) comes back on the card to re-apply. Points added by hand stay.
  const updateCorrected = async () => {
    if (corrected === undefined) return;
    const eps = [...applications.values()].filter((a) => a.episode >= corrected).map((a) => a.episode).sort((a, b) => b - a);
    const span = eps.length === 1 ? `episode ${corrected}` : `episodes ${corrected}–${eps[0]}`;
    const ok = await confirmDialog({
      title: `Update your league for episode ${corrected}?`,
      description: `Its results were corrected. This removes the auto-scored points for ${span} and puts ${
        eps.length === 1 ? "it" : "them"
      } back on this card so you can apply the corrected results. Points you added by hand stay.`,
      confirmText: "Update my league",
    });
    if (!ok) return;
    setBusy(true);
    try {
      for (const ep of eps) await onUndo(ep);
      await refresh();
      toast.success(`Episode ${corrected} is back on the card with the corrected results`);
    } catch (err: any) {
      await refresh();
      toast.error(`Couldn't update: ${err?.message || "try again"}`);
    } finally {
      setBusy(false);
    }
  };
  const correctedLine = corrected !== undefined && !open && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6 text-sm border-t-2 border-border">
      <AlertTriangle className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
      <span>Episode {corrected}'s results were corrected after you applied them.</span>
      <button
        type="button"
        onClick={updateCorrected}
        disabled={busy}
        className="inline-flex min-h-[40px] items-center font-bold underline underline-offset-2"
      >
        Update my league
      </button>
    </div>
  );

  if (!plan) {
    if (corrected !== undefined) {
      return (
        <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
          <div className="plank overflow-hidden">
            {correctedLine}
            {undoLine}
          </div>
        </div>
      );
    }
    if (blocked) {
      return (
        <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
          <div className="glass rounded-[12px] px-4 py-3 text-sm">
            New episode results are being corrected. The Apply button comes back once they're fixed.
          </div>
        </div>
      );
    }
    if (!lastApplied) return null;
    return (
      <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
        <div className="plank overflow-hidden">{undoLine}</div>
      </div>
    );
  }

  // Hidden until the next episode is posted (a correction notice still shows)
  if (hidden && !open) {
    if (corrected === undefined) return null;
    return (
      <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
        <div className="plank overflow-hidden">{correctedLine}</div>
      </div>
    );
  }

  const grouped = GROUPS.map((g) => ({ ...g, events: plan.events.filter((e) => e.key === g.key) })).filter(
    (g) => g.events.length > 0
  );
  // Only teams whose score changes (a 0-point exit alone isn't worth a line)
  const teams = pointsByTeam(plan).filter(([, pts]) => pts !== 0);
  // Every name we couldn't match needs a pick (or "not in my league") before applying
  const unmatched = [...plan.unmatchedExits, ...plan.unmatchedOther];
  const needsPicks = unmatched.filter((n) => !(n in overrides));
  const nothingToAdd = plan.events.length === 0 && plan.eliminate.length === 0;
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  const pickable = [
    ...contestants.filter((c) => !c.isEliminated).sort(byName),
    ...contestants.filter((c) => c.isEliminated).sort(byName),
  ];

  const apply = async () => {
    setBusy(true);
    try {
      const added = await onApply(
        plan.episode,
        plan.events.map((e) => ({ contestantId: e.contestantId, contestantName: e.contestantName, action: e.action, points: e.points })),
        plan.eliminate,
        plan.postMerge
      );
      await refresh();
      setOpen(false);
      const ep = plan.episode;
      toast.success(added > 0 ? `Episode ${ep} scored: ${added} ${added === 1 ? "event" : "events"} added` : `Episode ${ep} was already scored, so nothing new was added. Moving you to episode ${ep + 1}.`, {
        action: added > 0 ? { label: "Undo", onClick: () => undo(ep) } : undefined,
      });
    } catch (err: any) {
      await refresh();
      if (err?.code === "23505") {
        setOpen(false);
        toast.info(`Episode ${plan.episode} was already applied by another commissioner.`);
      } else {
        toast.error(`Couldn't apply episode ${plan.episode}: ${err?.message || "try again"}`);
      }
    } finally {
      setBusy(false);
    }
  };

  // For leagues that started after this episode aired: record who left, give no points
  const skip = async () => {
    // A castaway we couldn't match has to be picked first, or they'd stay "still in"
    if (needsPicks.length > 0) {
      setOpen(true);
      return;
    }
    const out = plan.eliminate.length;
    const ok = await confirmDialog({
      title: `Skip episode ${plan.episode}?`,
      description:
        "No points for it. " +
        (out > 0 ? `${out === 1 ? "The castaway who went home is" : `The ${out} castaways who went home are`} still marked out of your league. ` : "") +
        "Use this for an episode your league didn't play, like one before you started. You can undo it for 2 days.",
      confirmText: `Skip episode ${plan.episode}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await onApply(plan.episode, [], plan.eliminate, plan.postMerge, true);
      await refresh();
      setOpen(false);
      const ep = plan.episode;
      toast.success(out > 0 ? `Episode ${ep} skipped. Marked who went home, no points added.` : `Episode ${ep} skipped. No points added.`, {
        action: out > 0 ? { label: "Undo", onClick: () => undo(ep) } : undefined,
      });
    } catch (err: any) {
      await refresh();
      if (err?.code === "23505") setOpen(false);
      else toast.error(err?.message || "Couldn't skip. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
      <section className="plank overflow-hidden" aria-live="polite">
        <div className="bg-header px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <p className="label-caps text-header-label flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Auto-scoring
            </p>
            <button
              type="button"
              onClick={hide}
              aria-label="Hide until the next episode is posted"
              title="Hide until the next episode is posted"
              className="-mr-2 -mt-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-header-label hover:opacity-80"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <h2 className="font-display text-3xl leading-none mt-1">Episode {plan.episode} results are in</h2>
          <p className="mt-2 text-sm text-header-label max-w-[60ch]">
            Who went home, who won immunity and survival points, ready to add in one tap. Watching later? Tap the X and this
            comes back when the next episode is posted.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 pt-4 sm:px-6">
          <Button variant="accent" className="h-11" onClick={() => setOpen(true)}>
            Add episode {plan.episode} points
          </Button>
          <Button variant="outline" className="h-11" onClick={skip} disabled={busy}>
            Skip episode {plan.episode}
          </Button>
          {waiting > 1 && (
            <span className="text-sm font-semibold text-muted-foreground tabular">
              {waiting - 1} more episode{waiting > 2 ? "s" : ""} after this one
            </span>
          )}
        </div>
        <div className="px-5 pb-3 pt-2 sm:px-6">
          <button
            type="button"
            onClick={() => setHowOpen((v) => !v)}
            aria-expanded={howOpen}
            className="inline-flex min-h-[40px] items-center gap-1 text-sm font-bold underline underline-offset-2"
          >
            How auto-scoring works
            <ChevronDown className={`h-4 w-4 transition-transform ${howOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {howOpen && (
            <ul className="mt-1 max-w-[65ch] list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>After each episode airs, we post the results here, usually by the next morning.</li>
              <li>
                Nothing changes in your league until you tap Add. You'll see exactly what gets added first (that list has
                spoilers), and you can undo it for 2 days.
              </li>
              <li>
                Skip an episode your league didn't play, like one before you started. No points, but anyone who went home is
                still marked out.
              </li>
              <li>
                Episodes wait for you in order, so you can catch up whenever you watch. The X hides this card until the next
                episode is posted.
              </li>
              <li>
                Cries, Jeff tosses, idols and bonuses stay manual. Prefer to score everything by hand? Turn auto-scoring off in
                Admin, under Scoring.
              </li>
            </ul>
          )}
        </div>
        {correctedLine}
        {undoLine}
      </section>

      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Episode {plan.episode} results</DialogTitle>
            <DialogDescription>
              {nothingToAdd
                ? "Everything from this episode is already in your league."
                : "Here's what gets added to your league. Anything you already entered is skipped."}
            </DialogDescription>
          </DialogHeader>

          {plan.existingForEpisode > 0 && (
            <div className="flex items-start gap-2 rounded-[12px] border-2 border-accent bg-accent/10 px-3 py-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-accent" aria-hidden="true" />
              <span>
                Your league already has <span className="tabular font-bold">{plan.existingForEpisode}</span> scores for
                episode {plan.episode}. Check the list below before adding.
              </span>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="space-y-3 rounded-[12px] border-2 border-accent bg-accent/10 p-3">
              <p className="text-sm font-bold">
                We couldn't find {unmatched.length === 1 ? "this name" : "these names"} in your league's cast. Pick who{" "}
                {unmatched.length === 1 ? "it is" : "each one is"}, or "Not in my league":
              </p>
              {unmatched.map((name, i) => (
                <div key={name} className="space-y-1">
                  <label htmlFor={`er-pick-${i}`} className="text-sm font-semibold">
                    {name}
                  </label>
                  <select
                    id={`er-pick-${i}`}
                    value={overrides[name] === "" ? NOT_IN_LEAGUE : overrides[name] ?? ""}
                    onChange={(e) =>
                      setOverrides((o) => ({ ...o, [name]: e.target.value === NOT_IN_LEAGUE ? "" : e.target.value }))
                    }
                    className="flex h-11 w-full rounded-[10px] border-2 border-input bg-card px-3 text-sm font-semibold"
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

          {grouped.length > 0 && (
            <ul className="divide-y divide-border">
              {grouped.map((g) => {
                const pts = g.events[0].points;
                return (
                  <li key={g.key} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {g.label}
                        {g.events.length > 1 && <span className="font-semibold text-muted-foreground tabular"> · {g.events.length}</span>}
                      </p>
                      <p className="text-sm text-muted-foreground">{namesWithCounts(g.events.map((e) => e.contestantName))}</p>
                    </div>
                    <span
                      className={`shrink-0 text-sm font-extrabold tabular ${
                        pts < 0 ? "text-destructive" : pts > 0 ? "text-success" : "text-muted-foreground"
                      }`}
                    >
                      {pts === 0 ? (EXIT_KEYS.has(g.key) ? "Out" : "0") : fmt(pts)}
                      {g.events.length > 1 && pts !== 0 ? " each" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {teams.length > 0 && (
            <div className="glass rounded-[12px] p-3">
              <p className="label-caps text-muted-foreground mb-1.5">By team</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                {teams.map(([team, pts]) => (
                  <li key={team} className="flex justify-between gap-3 text-sm">
                    <span className="truncate font-semibold">{team}</span>
                    <span className="font-extrabold tabular">{fmt(pts)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1 text-sm text-muted-foreground">
            {plan.alreadyEntered > 0 && (
              <p className="tabular">{plan.alreadyEntered} already entered by hand, so they're skipped.</p>
            )}
            {results.find((r) => r.episode === plan.episode)?.source === "auto" && (
              <p>Filled in automatically from the Survivor Wiki and Wikipedia.</p>
            )}
            <p>Cries, Jeff tosses, idols and bonuses stay manual. You can undo this afterward.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="h-11" onClick={skip} disabled={busy || needsPicks.length > 0}>
              Skip this episode
            </Button>
            <Button variant="accent" className="h-11" onClick={apply} disabled={busy || needsPicks.length > 0}>
              {busy
                ? "Adding…"
                : needsPicks.length > 0
                ? "Pick the names above"
                : nothingToAdd
                ? "Mark as done"
                : `Add ${plan.events.length} ${plan.events.length === 1 ? "event" : "events"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
