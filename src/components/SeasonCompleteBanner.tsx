import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trophy, Loader2, Sparkles } from "lucide-react";

interface NewSeasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  season: number;
  nextSeason: number;
  /** Whether anyone drafted this season (if not, there's nothing to save) */
  hasDraft: boolean;
  /** A few drafted castaway names, so the commissioner can see which season is being saved */
  castPreview?: string;
  onConfirm: () => Promise<boolean>;
}

/**
 * One confirmation step for moving a league to the next season.
 * Used by the banner at the top of the league and by Admin > Season Management.
 */
export const NewSeasonDialog = ({
  open,
  onOpenChange,
  season,
  nextSeason,
  hasDraft,
  castPreview,
  onConfirm,
}: NewSeasonDialogProps) => {
  const [isStarting, setIsStarting] = useState(false);

  const handleConfirm = async () => {
    setIsStarting(true);
    try {
      const ok = await onConfirm();
      if (ok) onOpenChange(false);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => !isStarting && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Start Season {nextSeason}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
              <li>
                {hasDraft
                  ? `Season ${season} final standings get saved to the History tab.`
                  : `Season ${season} had no draft, so there's nothing to save to History.`}
              </li>
              {hasDraft && castPreview && (
                <li>
                  Drafted castaways being saved: {castPreview}. If these are Season {nextSeason}{" "}
                  castaways, cancel and change the season number in Admin instead.
                </li>
              )}
              <li>Your teams, members and scoring settings stay the same.</li>
              <li>The official Season {nextSeason} cast is added automatically if it's posted. Then you run a new draft.</li>
            </ul>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isStarting}>Cancel</AlertDialogCancel>
          <Button variant="accent" onClick={handleConfirm} disabled={isStarting}>
            {isStarting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </>
            ) : (
              `Start Season ${nextSeason}`
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

interface SeasonCompleteBannerProps {
  season: number;
  nextSeason: number;
  /**
   * "completed" = this season is over; "new_available" = a newer season has started airing;
   * "relabel" = the league is already playing the newer cast but is labeled with the old number
   */
  reason: "completed" | "new_available" | "relabel";
  isLeagueAdmin: boolean;
  onStartNewSeason: () => void;
}

export const SeasonCompleteBanner = ({
  season,
  nextSeason,
  reason,
  isLeagueAdmin,
  onStartNewSeason,
}: SeasonCompleteBannerProps) => {
  const Icon = reason === "completed" ? Trophy : Sparkles;
  const title =
    reason === "completed"
      ? `Season ${season} is complete`
      : reason === "relabel"
        ? `This league is playing Season ${nextSeason}`
        : `Season ${nextSeason} is here`;
  const detail = isLeagueAdmin
    ? reason === "completed"
      ? `Save it to History and set up Season ${nextSeason}.`
      : reason === "relabel"
        ? `Your castaways are the Season ${nextSeason} cast, but the league is labeled Season ${season}. Fixing the label changes nothing else.`
        : `Your league is still on Season ${season}. Save it to History and set up Season ${nextSeason}.`
    : reason === "relabel"
      ? `Your commissioner can update the season label.`
      : `Your commissioner can start Season ${nextSeason} for the league.`;
  const buttonLabel =
    reason === "relabel" ? `Mark as Season ${nextSeason}` : `Start Season ${nextSeason}`;

  return (
    <div className="border-b-2 border-accent bg-accent/10">
      <div className="container max-w-7xl mx-auto px-4 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-plank bg-warning text-warning-foreground">
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-extrabold text-foreground">{title}</p>
              <p className="text-sm text-muted-foreground">{detail}</p>
            </div>
          </div>

          {isLeagueAdmin && (
            <Button
              variant="accent"
              onClick={onStartNewSeason}
              className="w-full sm:w-auto shrink-0"
            >
              <Trophy className="h-4 w-4" />
              {buttonLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
