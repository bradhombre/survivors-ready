import { useMemo, useState } from "react";
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
import { Sparkles } from "lucide-react";
import type { Contestant, ScoringEvent } from "@/types/survivor";
import type { ScoringConfig } from "@/lib/scoring";
import { buildEpisodePlan, pointsByTeam, type ActionKey, type EpisodePlan } from "@/lib/episodeResults";
import { useLeagueEpisodeResults } from "@/hooks/useEpisodeResults";

interface EpisodeResultsCardProps {
  leagueId: string;
  sessionId?: string;
  season: number;
  userId?: string;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  scoringConfig: ScoringConfig | null;
  onApply: (
    episode: number,
    events: { contestantId: string; contestantName: string; action: string; points: number }[],
    eliminateIds: string[],
    postMerge: boolean
  ) => Promise<number>;
}

const GROUPS: { key: ActionKey; label: string }[] = [
  { key: "VOTED_OUT", label: "Voted out" },
  { key: "QUIT", label: "Quit or left" },
  { key: "WIN_IMMUNITY", label: "Won individual immunity" },
  { key: "SURVIVE_PRE", label: "Survived (pre-merge)" },
  { key: "SURVIVE_POST", label: "Survived (post-merge)" },
  { key: "MAKE_JURY", label: "Made the jury" },
  { key: "MAKE_FINAL", label: "Made Final Tribal" },
  { key: "WIN_SURVIVOR", label: "Sole Survivor" },
];

const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

/**
 * Commissioner-only card: "Episode N results are in". One tap adds the big events the site
 * owner entered (voted out, survived, immunity, jury, finale), skipping anything already there.
 */
export function EpisodeResultsCard({
  leagueId,
  sessionId,
  season,
  userId,
  contestants,
  scoringEvents,
  scoringConfig,
  onApply,
}: EpisodeResultsCardProps) {
  const { results, handled, recordHandled } = useLeagueEpisodeResults(season, sessionId);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const pending = useMemo(
    () => results.filter((r) => !handled.has(r.episode)).sort((a, b) => a.episode - b.episode),
    [results, handled]
  );
  const next = pending[0];

  const plan: EpisodePlan | null = useMemo(
    () =>
      next
        ? buildEpisodePlan({ published: results, episode: next.episode, contestants, scoringEvents, scoringConfig })
        : null,
    [next, results, contestants, scoringEvents, scoringConfig]
  );

  if (!next || !plan) return null;

  const grouped = GROUPS.map((g) => ({ ...g, events: plan.events.filter((e) => e.key === g.key) })).filter(
    (g) => g.events.length > 0
  );
  const teams = pointsByTeam(plan);
  const nothingToAdd = plan.events.length === 0 && plan.eliminate.length === 0;

  const apply = async () => {
    setBusy(true);
    try {
      const added = await onApply(
        plan.episode,
        plan.events.map((e) => ({ contestantId: e.contestantId, contestantName: e.contestantName, action: e.action, points: e.points })),
        plan.eliminate,
        plan.postMerge
      );
      await recordHandled({ leagueId, episode: plan.episode, eventsAdded: added, skipped: false, userId });
      toast.success(
        added > 0 ? `Episode ${plan.episode} scored: ${added} events added` : `Episode ${plan.episode} marked done`
      );
      setOpen(false);
    } catch (err: any) {
      toast.error(`Couldn't apply episode ${plan.episode}: ${err?.message || "try again"}`);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await recordHandled({ leagueId, episode: plan.episode, eventsAdded: 0, skipped: true, userId });
      toast.success(`Episode ${plan.episode} skipped. Nothing was added.`);
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't skip. Try again.");
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
          {pending.length > 1 && (
            <span className="text-sm font-semibold text-muted-foreground tabular">
              {pending.length - 1} more episode{pending.length > 2 ? "s" : ""} waiting after this one
            </span>
          )}
        </div>
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Episode {plan.episode} results</DialogTitle>
            <DialogDescription>
              {nothingToAdd
                ? "Everything from this episode is already in your league."
                : "Here's what gets added to your league. Anything you already entered is skipped."}
            </DialogDescription>
          </DialogHeader>

          {grouped.length > 0 && (
            <ul className="divide-y divide-border">
              {grouped.map((g) => {
                const pts = g.events[0].points;
                const many = g.events.length > 4;
                return (
                  <li key={g.key} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">{g.label}</p>
                      <p className="text-sm text-muted-foreground">
                        {many
                          ? `${g.events.length} castaways`
                          : g.events.map((e) => e.contestantName).join(", ")}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-extrabold tabular text-success">
                      {pts === 0 ? (g.key === "VOTED_OUT" || g.key === "QUIT" ? "Out" : "0") : fmt(pts)}
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
            {plan.unmatched.length > 0 && (
              <p>
                Not in your league's cast: {plan.unmatched.join(", ")}. Add those by hand if your cast uses a different
                spelling.
              </p>
            )}
            <p>Cries, Jeff tosses, idols and bonuses stay manual.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" className="h-11" onClick={skip} disabled={busy}>
              Skip this episode
            </Button>
            <Button variant="accent" className="h-11" onClick={apply} disabled={busy}>
              {busy ? "Adding…" : nothingToAdd ? "Mark as done" : `Add ${plan.events.length} events`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
