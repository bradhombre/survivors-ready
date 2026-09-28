import { Contestant } from "@/types/survivor";
import { Users, Tv } from "lucide-react";

interface SeasonProgressBarProps {
  episode: number;
  totalEpisodes?: number;
  isPostMerge: boolean;
  contestants: Contestant[];
}

/**
 * Segmented season bar (design spec 01): one segment per episode.
 * Done = filled, current = clay, upcoming = faint.
 */
export function SeasonProgressBar({
  episode,
  totalEpisodes: plannedEpisodes = 13,
  isPostMerge,
  contestants,
}: SeasonProgressBarProps) {
  // Most seasons are 13 episodes; longer ones grow the bar instead of overflowing it
  const totalEpisodes = Math.max(plannedEpisodes, episode);
  const remaining = contestants.filter((c) => !c.isEliminated).length;
  const total = contestants.length;

  return (
    <div className="glass rounded-[12px] px-4 py-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Episode */}
        <div className="flex items-center gap-2 text-sm">
          <Tv className="h-4 w-4 text-muted-foreground" />
          <span className="font-bold">
            Episode <span className="tabular">{episode}</span>{" "}
            <span className="font-medium text-muted-foreground">of {totalEpisodes}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Phase is shown (and toggled) by the chip in the Game header, so it isn't repeated here */}
          {/* Remaining */}
          {total > 0 && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span>
                <span className="font-black tabular text-foreground">{remaining}</span>
                <span className="tabular">/{total}</span> still in
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Segmented episode bar */}
      <div
        role="progressbar"
        aria-label="Season progress"
        aria-valuemin={0}
        aria-valuemax={totalEpisodes}
        aria-valuenow={Math.min(episode, totalEpisodes)}
        aria-valuetext={`Episode ${episode} of ${totalEpisodes}`}
        className="flex gap-1"
      >
        {Array.from({ length: totalEpisodes }, (_, i) => i + 1).map((ep) => (
          <span
            key={ep}
            aria-hidden="true"
            className={`h-2 flex-1 rounded-full ${
              ep < episode ? "bg-primary" : ep === episode ? "bg-accent" : "bg-primary/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
