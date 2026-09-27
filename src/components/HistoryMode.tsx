import { useState, useEffect, useMemo } from "react";
import { ContestantAvatar } from "./ContestantAvatar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArchivedSeason, Player } from "@/types/survivor";
import { Download, Calendar, Users, Trophy } from "lucide-react";

interface HistoryModeProps {
  leagueId?: string;
  archivedSeasons: ArchivedSeason[];
  playerProfiles: Record<Player, { avatar?: string }>;
}

export const HistoryMode = ({ archivedSeasons, playerProfiles }: HistoryModeProps) => {
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<string>("");
  const [selectedSeason, setSelectedSeason] = useState<ArchivedSeason | null>(null);

  // One entry per season, newest first (archivedSeasons is already newest-first,
  // so if a season was archived twice we keep the latest copy)
  const seasonNumbers = useMemo(
    () => Array.from(new Set(archivedSeasons.map((s) => s.season))).sort((a, b) => b - a),
    [archivedSeasons]
  );

  // Auto-select the most recent season when data is available
  useEffect(() => {
    if (selectedSeasonNumber) return;
    if (seasonNumbers.length > 0) setSelectedSeasonNumber(String(seasonNumbers[0]));
  }, [seasonNumbers, selectedSeasonNumber]);

  // When season selection changes, find the matching archived data
  useEffect(() => {
    if (selectedSeasonNumber) {
      const seasonNum = parseInt(selectedSeasonNumber);
      const archived = archivedSeasons.find((s) => s.season === seasonNum);
      setSelectedSeason(archived || null);
    }
  }, [selectedSeasonNumber, archivedSeasons]);

  const exportSeason = (season: ArchivedSeason) => {
    const dataStr = JSON.stringify(season, null, 2);
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
    const exportFileDefaultName = `survivor-s${season.season}-archived.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 0: return "🥇";
      case 1: return "🥈";
      case 2: return "🥉";
      default: return "4️⃣";
    }
  };

  // No completed sessions or archived seasons
  if (archivedSeasons.length === 0) {
    return (
      <div className="container max-w-6xl mx-auto p-4 md:p-8 space-y-8">
        <div className="text-center space-y-6">
          <h1 className="font-display text-5xl md:text-6xl leading-none text-primary">Season history</h1>
          <div className="glass rounded-[14px] mx-auto max-w-md px-6 py-8 space-y-2">
            <Trophy className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-display text-2xl leading-none">No archived seasons yet</p>
            <p className="text-sm text-muted-foreground">Complete a season and start a new draft to archive it here</p>
          </div>
        </div>
      </div>
    );
  }

  // Show season selector and details
  if (selectedSeason) {
    return (
      <div className="container max-w-6xl mx-auto p-4 md:p-8 space-y-8">
        {/* Season Selector */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div className="flex items-end gap-4 flex-wrap">
            <div className="space-y-1">
              <p className="label-caps text-muted-foreground tabular">Season {selectedSeason.season}</p>
              <h1 className="font-display text-4xl leading-none text-primary">Season history</h1>
            </div>
            <Select value={selectedSeasonNumber} onValueChange={setSelectedSeasonNumber}>
              <SelectTrigger className="w-[180px] h-11 rounded-[10px] border-2 bg-card font-bold">
                <SelectValue placeholder="Select season" />
              </SelectTrigger>
              <SelectContent>
                {seasonNumbers.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Season {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => exportSeason(selectedSeason)} variant="outline">
            <Download className="h-4 w-4" />
            Export season
          </Button>
        </div>

        {/* Final Standings */}
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none text-primary">Final standings</h2>
          <Card className="overflow-hidden">
            <ol className="divide-y divide-border">
              {selectedSeason.finalStandings.map((entry, index) => (
                <li
                  key={entry.player}
                  className={`flex min-h-[64px] items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5 ${index === 0 ? "bg-warning/20" : ""}`}
                >
                  <span
                    className={`flex h-10 min-w-10 shrink-0 items-center justify-center rounded-full px-2 text-xl font-black tabular ${index === 0 ? "bg-warning text-warning-foreground border-2 border-plank" : "text-primary"}`}
                    aria-label={`Rank ${index + 1}`}
                  >
                    {index + 1}
                  </span>

                  {playerProfiles[entry.player]?.avatar && (
                    <img
                      src={playerProfiles[entry.player].avatar}
                      alt={entry.player}
                      className="h-12 w-12 shrink-0 rounded-full object-cover border-2 border-plank"
                    />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-2xl leading-none break-words">{entry.player}</h3>
                      {index === 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full border-2 border-plank bg-warning px-2.5 py-0.5 text-xs font-bold text-warning-foreground">
                          <Trophy className="h-3 w-3" aria-hidden="true" />
                          Winner
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-semibold text-muted-foreground tabular">{entry.activeCount} still in</p>
                  </div>

                  <div className="shrink-0 text-right">
                    <p className="text-3xl font-black leading-none tracking-tight tabular sm:text-4xl">{entry.score}</p>
                    <p className="label-caps text-muted-foreground">pts</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        {/* Season Stats */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Card className="flex items-center gap-4 p-4 sm:block sm:p-5 sm:space-y-2">
            <Users className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-3xl font-black leading-none tabular">{selectedSeason.contestants.length}</p>
            <p className="label-caps text-muted-foreground">Total contestants</p>
          </Card>
          <Card className="flex items-center gap-4 p-4 sm:block sm:p-5 sm:space-y-2">
            <Trophy className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-3xl font-black leading-none tabular">{selectedSeason.scoringEvents.length}</p>
            <p className="label-caps text-muted-foreground">Scoring events</p>
          </Card>
          <Card className="flex items-center gap-4 p-4 sm:block sm:p-5 sm:space-y-2">
            <Calendar className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="text-3xl font-black leading-none tabular">
              {selectedSeason.scoringEvents.length > 0
                ? Math.max(...selectedSeason.scoringEvents.map((e) => e.episode))
                : 0}
            </p>
            <p className="label-caps text-muted-foreground">Episodes tracked</p>
          </Card>
        </div>

        {/* Contestants by Team */}
        <div className="space-y-4">
          <h2 className="font-display text-3xl leading-none text-primary">Team rosters</h2>
          {selectedSeason.finalStandings.map((entry) => entry.player as Player).map((player) => {
            const playerContestants = selectedSeason.contestants.filter(c => c.owner === player);
            if (playerContestants.length === 0) return null;

            return (
              <Card key={player} className="p-5 sm:p-6 space-y-4">
                <h3 className="font-display text-2xl leading-none">{player}'s team</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {playerContestants.map((contestant) => (
                    <div
                      key={contestant.id}
                      className="glass rounded-[12px] p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="sm" isEliminated={contestant.isEliminated} />
                        <p className={`font-bold ${contestant.isEliminated ? "line-through text-muted-foreground" : ""}`}>{contestant.name}</p>
                      </div>
                      <div className="text-xs text-muted-foreground space-y-0.5 tabular">
                        {contestant.age && <p>Age: {contestant.age}</p>}
                        {contestant.location && <p className="truncate">{contestant.location}</p>}
                        {contestant.tribe && <p>Tribe: {contestant.tribe}</p>}
                        <p>Pick #{contestant.pickNumber}</p>
                      </div>
                      {contestant.isEliminated && <p className="inline-block rounded-full bg-destructive px-2.5 py-0.5 text-xs font-bold text-destructive-foreground">Voted out</p>}
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  // Default view: prompt to select a season
  return (
    <div className="container max-w-6xl mx-auto p-4 md:p-8 space-y-8">
      <div className="flex items-center gap-4 flex-wrap">
        <h1 className="font-display text-4xl leading-none text-primary">Season history</h1>
        <Select value={selectedSeasonNumber} onValueChange={setSelectedSeasonNumber}>
          <SelectTrigger className="w-[180px] h-11 rounded-[10px] border-2 bg-card font-bold">
            <SelectValue placeholder="Select season" />
          </SelectTrigger>
          <SelectContent>
            {seasonNumbers.map((n) => (
              <SelectItem key={n} value={String(n)}>
                Season {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="text-center py-12">
        <p className="text-muted-foreground">
          Select a season above to view its history
        </p>
      </div>
    </div>
  );
};
