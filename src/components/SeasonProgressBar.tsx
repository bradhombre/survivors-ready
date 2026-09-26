import { Contestant } from "@/types/survivor";
import { Users, Tv, Flame, TreePalm } from "lucide-react";

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
  totalEpisodes = 13,
  isPostMerge,
  contestants,
}: SeasonProgressBarProps) {
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
          {/* Phase chip */}
          <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-border px-2.5 py-0.5 text-xs font-bold">
            {isPostMerge ? (
              <Flame className="h-3.5 w-3.5 text-accent" />
            ) : (
              <TreePalm className="h-3.5 w-3.5 text-success" />
            )}
            {isPostMerge ? "Post-merge" : "Pre-merge"}
          </span>

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
