import { useEffect, useMemo, useState } from "react";
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
import { AlertTriangle, Sparkles, Undo2 } from "lucide-react";
import type { Contestant, ScoringEvent } from "@/types/survivor";
import type { ScoringConfig } from "@/lib/scoring";
import {
  buildEpisodePlan,
  nextPendingEpisode,
  pointsByTeam,
  type ActionKey,
} from "@/lib/episodeResults";
import { useLeagueEpisodeResults } from "@/hooks/useEpisodeResults";

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
 * Commissioner-only card: "Episode N results are in". One tap adds the big events the site
 * owner entered (voted out, survived, immunity, jury, finale), skipping anything already there.
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

  const handled = useMemo(() => new Set(applications.keys()), [applications]);
  const { next, blocked, waiting } = useMemo(() => nextPendingEpisode(results, handled), [results, handled]);

  // Picks for names we couldn't match belong to one episode
  useEffect(() => setOverrides({}), [next]);

  const plan = useMemo(
    () =>
      next !== undefined
        ? buildEpisodePlan({ published: results, episode: next, contestants, scoringEvents, scoringConfig, overrides })
        : null,
    [next, results, contestants, scoringEvents, scoringConfig, overrides]
  );

  // Most recent auto-scored episode, for the undo line (within 2 days)
  const lastApplied = useMemo(() => {
    const recent = [...applications.values()]
      .filter((a) => !a.skipped && a.events_added > 0 && Date.now() - Date.parse(a.applied_at) < 2 * 864e5)
      .sort((a, b) => b.episode - a.episode);
    return recent[0];
  }, [applications]);

  if (!ok) return null;

  const undo = async (episode: number) => {
    if (!window.confirm(`Undo episode ${episode} auto-scoring? The points it added are removed and castaways it marked out come back.`)) return;
    setBusy(true);
    try {
      const n = await onUndo(episode);
      await refresh();
      toast.success(`Episode ${episode} auto-scoring undone (${n} events removed)`);
    } catch (err: any) {
      toast.error(`Couldn't undo: ${err?.message || "try again"}`);
    } finally {
      setBusy(false);
    }
  };

  const undoLine = lastApplied && !open && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 sm:px-6 text-sm text-muted-foreground border-t-2 border-border">
      <span className="tabular">
        Episode {lastApplied.episode} was auto-scored ({lastApplied.events_added} events).
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

  if (!plan) {
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

  const grouped = GROUPS.map((g) => ({ ...g, events: plan.events.filter((e) => e.key === g.key) })).filter(
    (g) => g.events.length > 0
  );
  const teams = pointsByTeam(plan);
  const needsPicks = plan.unmatchedExits.filter((n) => !(n in overrides));
  const nothingToAdd = plan.events.length === 0 && plan.eliminate.length === 0;
  const stillIn = contestants.filter((c) => !c.isEliminated).sort((a, b) => a.name.localeCompare(b.name));

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
      toast.success(added > 0 ? `Episode ${ep} scored: ${added} events added` : `Episode ${ep} marked done`, {
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

  const skip = async () => {
    if (!window.confirm(`Skip episode ${plan.episode}? Nothing is added and this card won't come back for it.`)) return;
    setBusy(true);
    try {
      await onApply(plan.episode, [], [], false, true);
      await refresh();
      setOpen(false);
      toast.success(`Episode ${plan.episode} skipped. Nothing was added.`);
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
          <p className="label-caps text-header-label flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Auto-scoring
          </p>
          <h2 className="font-display text-3xl leading-none mt-1">Episode {plan.episode} results are in</h2>
          <p className="mt-2 text-sm text-header-label max-w-[60ch]">
            Voted out, survival points and immunity, ready to add in one tap. Review first; the details are spoilers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
          <Button variant="accent" className="h-11" onClick={() => setOpen(true)}>
            Review and apply
          </Button>
          {waiting > 1 && (
            <span className="text-sm font-semibold text-muted-foreground tabular">
              {waiting - 1} more episode{waiting > 2 ? "s" : ""} waiting after this one
            </span>
          )}
        </div>
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

          {plan.unmatchedExits.length > 0 && (
            <div className="space-y-3 rounded-[12px] border-2 border-accent bg-accent/10 p-3">
              <p className="text-sm font-bold">
                We couldn't find {plan.unmatchedExits.length === 1 ? "this castaway" : "these castaways"} in your league's
                cast. Pick who it is so they're marked out:
              </p>
              {plan.unmatchedExits.map((name, i) => (
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
                    {stillIn.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
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
                      <p className="text-sm text-muted-foreground">{g.events.map((e) => e.contestantName).join(", ")}</p>
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
            {plan.unmatchedOther.length > 0 && (
              <p>Not in your league's cast: {plan.unmatchedOther.join(", ")}. Add those by hand if needed.</p>
            )}
            {results.find((r) => r.episode === plan.episode)?.source === "auto" && (
              <p>Filled in automatically from the Survivor Wiki and Wikipedia.</p>
            )}
            <p>Cries, Jeff tosses, idols and bonuses stay manual. You can undo this afterward.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="h-11" onClick={skip} disabled={busy}>
              Skip this episode
            </Button>
            <Button variant="accent" className="h-11" onClick={apply} disabled={busy || needsPicks.length > 0}>
              {busy
                ? "Adding…"
                : needsPicks.length > 0
                ? "Pick the castaway above"
                : nothingToAdd
                ? "Mark as done"
                : `Add ${plan.events.length} events`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
