import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Contestant, Player, ScoringEvent } from "@/types/survivor";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { TeamAvatar } from "./TeamAvatar";
import { ContestantAvatar } from "./ContestantAvatar";
import { Crown, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface WinnerTakesAllModeProps {
  leagueId?: string;
  contestants: Contestant[];
  draftOrder: Player[];
  isAdmin: boolean;
  sessionId?: string;
  sessionStatus?: string;
  scoringEvents?: ScoringEvent[];
}

export function WinnerTakesAllMode({
  leagueId,
  contestants,
  draftOrder,
  isAdmin,
  sessionId,
  sessionStatus,
  scoringEvents = [],
}: WinnerTakesAllModeProps) {
  const { teams } = useLeagueTeams({ leagueId });

  const teamAvatarMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    teams.forEach((team) => {
      map[team.name] = team.avatar_url || null;
    });
    return map;
  }, [teams]);

  const draftedContestants = contestants.filter((c) => c.owner);
  const remainingContestants = draftedContestants.filter((c) => !c.isEliminated);
  const hasMultiplePicks = draftOrder.some(player => 
    draftedContestants.filter(c => c.owner === player).length > 1
  );

  // Check if there's a WIN_SURVIVOR scoring event (winner declared)
  // We detect winner by checking if a contestant's owner has the WIN_SURVIVOR event
  // For simplicity, we'll check if session is completed and only 1 remains
  // The crowned contestant carries the "Win Survivor" scoring event. Fall back to
  // the last one standing for seasons crowned before that was checked.
  const crownedId = [...scoringEvents].reverse().find((e) => e.action.includes("Win Survivor"))?.contestantId;
  const crownedContestant =
    draftedContestants.find((c) => c.id === crownedId) || remainingContestants[0] || null;
  const winner = sessionStatus === "completed" ? crownedContestant : null;

  const handleToggleElimination = async (contestant: Contestant) => {
    if (!sessionId) return;
    await supabase
      .from("contestants")
      .update({ is_eliminated: !contestant.isEliminated })
      .eq("id", contestant.id);
  };

  const handleCrownWinner = async (contestant: Contestant) => {
    if (!sessionId) return;
    const confirmed = confirm(
      `Crown ${contestant.name} as the Sole Survivor?\n\nThis will complete the season. ${contestant.owner} wins!`
    );
    if (!confirmed) return;

    // Add WIN_SURVIVOR scoring event
    await supabase.from("scoring_events").insert({
      session_id: sessionId,
      contestant_id: contestant.id,
      contestant_name: contestant.name,
      action: "Win Survivor 👑",
      points: 100,
      episode: 1,
    });

    // Mark session as completed
    await supabase
      .from("game_sessions")
      .update({ status: "completed" } as any)
      .eq("id", sessionId);

    toast.success(`${contestant.owner} wins with ${contestant.name}!`);
  };

  // Celebration state
  if (sessionStatus === "completed" && crownedContestant) {
    const winnerContestant = crownedContestant;
    return (
      <div className="container max-w-4xl mx-auto p-4 md:p-8 space-y-8">
        <div className="text-center space-y-6">
          <h1 className="font-display text-5xl md:text-6xl leading-none text-primary">
            Sole Survivor
          </h1>
          <Card className="p-8 max-w-md mx-auto space-y-4 bg-success text-success-foreground">
            <Badge className="gap-1 border-plank bg-warning text-warning-foreground hover:bg-warning label-caps">
              <Trophy className="h-3.5 w-3.5" />
              Winner
            </Badge>
            <ContestantAvatar
              name={winnerContestant.name}
              imageUrl={winnerContestant.imageUrl}
              size="md"
              className="mx-auto !h-24 !w-24 !text-3xl"
            />
            <h2 className="font-display text-4xl leading-[0.95] break-words">{winnerContestant.name}</h2>
            <div className="flex items-center justify-center gap-2">
              <TeamAvatar
                teamName={String(winnerContestant.owner)}
                avatarUrl={teamAvatarMap[winnerContestant.owner || ""] || null}
                size="sm"
              />
              <span className="text-xl font-extrabold">{winnerContestant.owner}</span>
            </div>
          </Card>

          {/* Show all picks */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
            {draftOrder.map((player) => {
              const picks = draftedContestants.filter((c) => c.owner === player);
              if (picks.length === 0) return null;
              const hasWinner = picks.some(p => p.id === winnerContestant.id);
              return (
                <Card
                  key={player}
                  className={`p-4 text-left ${hasWinner ? "border-accent bg-warning/20" : "opacity-60"}`}
                >
                  <div className="flex items-center gap-3">
                    <TeamAvatar
                      teamName={String(player)}
                      avatarUrl={teamAvatarMap[player] || null}
                      size="md"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-display text-2xl leading-none truncate">{player}</p>
                      <div className="mt-2 space-y-1.5">
                        {picks.map(pick => (
                          <div key={pick.id} className="flex items-center gap-2">
                            <ContestantAvatar
                              name={pick.name}
                              imageUrl={pick.imageUrl}
                              size="xs"
                              isEliminated={pick.isEliminated}
                            />
                            <span className={`text-sm ${pick.isEliminated ? "line-through text-muted-foreground" : ""}`}>
                              {pick.name}
                            </span>
                            {pick.id === winnerContestant.id && (
                              <span className="inline-flex items-center gap-1 rounded-full border-2 border-plank bg-warning px-2 py-0.5 text-[11px] font-extrabold text-warning-foreground">
                                <Trophy className="h-3 w-3" />
                                Winner
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    {hasWinner && <Trophy className="h-5 w-5 shrink-0 text-accent" />}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-4 md:p-8 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="font-display text-4xl md:text-5xl leading-none text-primary">
          Winner takes all
        </h1>
        <p className="text-muted-foreground">
          <span className="font-black tabular text-foreground">{remainingContestants.length}</span> of{" "}
          <span className="tabular">{draftedContestants.length}</span> picks still alive
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {draftOrder.map((player) => {
          const picks = draftedContestants.filter((c) => c.owner === player);
          if (picks.length === 0) return null;
          const allEliminated = picks.every(p => p.isEliminated);
          const aliveCount = picks.filter(p => !p.isEliminated).length;

          return (
            <Card
              key={player}
              className={`p-4 ${allEliminated ? "opacity-60" : ""}`}
            >
              <div className="flex items-center gap-3">
                <TeamAvatar
                  teamName={String(player)}
                  avatarUrl={teamAvatarMap[player] || null}
                  size="md"
                  className="shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-display text-2xl leading-none truncate">{player}</p>
                  <div className="space-y-1.5 mt-2">
                    {picks.map(pick => (
                      <div key={pick.id} className="flex items-center gap-2">
                        <ContestantAvatar
                          name={pick.name}
                          imageUrl={pick.imageUrl}
                          size="sm"
                          isEliminated={pick.isEliminated}
                        />
                        <span className={`min-w-0 truncate text-sm ${pick.isEliminated ? "line-through text-muted-foreground" : "font-semibold"}`}>
                          {pick.name}
                        </span>
                        {pick.isEliminated ? (
                          <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-extrabold text-destructive-foreground">
                            Out
                          </span>
                        ) : (
                          <span className="shrink-0 rounded-full bg-success px-2 py-0.5 text-[11px] font-extrabold text-success-foreground">
                            Still in
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="mt-4 space-y-2 border-t-2 border-border pt-3">
                  {picks.map(pick => (
                    <div key={pick.id} className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-muted-foreground truncate min-w-0 flex-shrink">{pick.name}</span>
                      <Button
                        size="sm"
                        variant={pick.isEliminated ? "outline" : "destructive"}
                        className="h-11 flex-1 text-sm"
                        onClick={() => handleToggleElimination(pick)}
                      >
                        {pick.isEliminated ? "Undo" : "Eliminate"}
                      </Button>
                      {!pick.isEliminated && remainingContestants.length <= 2 && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-11 bg-warning text-sm text-warning-foreground hover:bg-warning/90"
                          onClick={() => handleCrownWinner(pick)}
                        >
                          <Crown className="h-4 w-4" />
                          Crown
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
