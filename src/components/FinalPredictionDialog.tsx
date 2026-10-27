import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Contestant, Player, ScoringEvent } from "@/types/survivor";
import { confirmDialog } from "@/components/ConfirmHost";
import { CheckCircle2, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useNotify as useToast } from "@/lib/notify";

interface Prediction {
  id: string;
  player_name: string;
  predicted_winner: string;
  is_revealed: boolean;
}

// Points for a correct tribal prediction. Fixed for now on purpose: the league's "Tribal Vote
// Correct" setting is used by most leagues for castaways who vote with the majority, not for
// this game, so predictions get their own setting when they move to team bonuses.
const PREDICTION_POINTS = 5;
// The action this screen saves for a correct prediction (the hand-scoring tile adds a ✅)
const PREDICTION_ACTION = "Tribal Vote Correct";
const isExitAction = (action: string) =>
  action.includes("Quit") || action.includes("Voted Out") || action.includes("Medevac");

interface FinalPredictionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  episode: number;
  /** Castaways still in the game (what players can predict) */
  finalists: Contestant[];
  /** Every castaway, including anyone already marked out (e.g. by auto-scoring) */
  allContestants: Contestant[];
  /** The league's points for Voted Out */
  votedOutPoints: number;
  /** Scoring events already saved for this episode */
  episodeEvents: ScoringEvent[];
  isAdmin: boolean;
  playerName: string | null;
  players: string[];
  onScore: (contestantId: string, contestantName: string, action: string, points: number) => void;
}

export const FinalPredictionDialog = ({
  open,
  onOpenChange,
  sessionId,
  episode,
  finalists,
  allContestants,
  votedOutPoints,
  episodeEvents,
  isAdmin,
  playerName,
  players,
  onScore,
}: FinalPredictionDialogProps) => {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | "">("");
  const [selectedWinner, setSelectedWinner] = useState("");
  const [actualVoteOut, setActualVoteOut] = useState("");
  const { toast } = useToast();

  // Who's already marked out this episode, and whether this screen already gave points
  const outThisEpisode = [
    ...new Set(episodeEvents.filter((e) => isExitAction(e.action)).map((e) => e.contestantName)),
  ];
  const pointsAlreadyGiven = episodeEvents.some((e) => e.action === PREDICTION_ACTION);

  useEffect(() => {
    if (open) {
      loadPredictions();
    }
  }, [open, sessionId, episode]);

  // Realtime subscription for live updates
  useEffect(() => {
    if (!open) return;

    const channel = supabase
      .channel(`final-predictions-${sessionId}-${episode}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'final_predictions',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          loadPredictions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, sessionId, episode]);

  const loadPredictions = async () => {
    const { data, error } = await supabase
      .from("final_predictions")
      .select("*")
      .eq("session_id", sessionId)
      .eq("episode", episode);

    if (error) {
      console.error("Error loading predictions:", error);
      return;
    }

    setPredictions(data || []);
  };

  const submitPrediction = async (playerNameOverride?: Player) => {
    const playerToSubmit = playerNameOverride || selectedPlayer;
    
    if (!playerToSubmit || !selectedWinner) {
      toast({
        title: "Missing information",
        description: "Please select both a player and their prediction",
        variant: "destructive",
      });
      return;
    }

    // Check database for existing prediction (not local state)
    const { data: existingData, error: checkError } = await supabase
      .from("final_predictions")
      .select("*")
      .eq("session_id", sessionId)
      .eq("episode", episode)
      .eq("player_name", playerToSubmit)
      .maybeSingle();

    if (checkError) {
      toast({
        title: "Error",
        description: "Failed to check existing predictions",
        variant: "destructive",
      });
      return;
    }
    
    if (existingData) {
      toast({
        title: "Already submitted",
        description: `${playerToSubmit} has already submitted a prediction`,
        variant: "destructive",
      });
      return;
    }

    const { error } = await supabase.from("final_predictions").insert({
      session_id: sessionId,
      player_name: playerToSubmit,
      predicted_winner: selectedWinner,
      episode,
    });

    if (error) {
      toast({
        title: "Error",
        description: "Failed to submit prediction",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Prediction submitted",
      description: `${playerToSubmit}'s prediction has been recorded`,
    });

    setSelectedPlayer("");
    setSelectedWinner("");
    loadPredictions();
  };

  const revealAndScore = async () => {
    if (predictions.length === 0) {
      toast({
        title: "No predictions",
        description: "No predictions have been submitted yet",
        variant: "destructive",
      });
      return;
    }

    // Mark all predictions as revealed
    const { error: updateError } = await supabase
      .from("final_predictions")
      .update({ is_revealed: true })
      .eq("session_id", sessionId)
      .eq("episode", episode);

    if (updateError) {
      toast({
        title: "Error",
        description: "Failed to reveal predictions",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Predictions revealed",
      description: "Now select who actually got voted out to award points",
    });
    
    loadPredictions();
  };

  const confirmVoteOut = async () => {
    if (!actualVoteOut) {
      toast({
        title: "Missing information",
        description: "Please select who actually got voted out",
        variant: "destructive",
      });
      return;
    }

    const correctGuessers = predictions.filter((p) => p.predicted_winner === actualVoteOut);

    // Confirming the same person twice would give everyone their points twice. Each player has
    // one prediction per episode, so if anyone who got this one right already has prediction
    // points this episode, this boot was already confirmed. Checked against the database too, in
    // case the screen hasn't caught up with a confirm made seconds ago.
    const ownerOf = new Map(allContestants.map((c) => [c.id, c.owner]));
    const alreadyPaidIds = new Set(episodeEvents.filter((e) => e.action === PREDICTION_ACTION).map((e) => e.contestantId));
    const { data: paidRows, error: paidError } = await supabase
      .from("scoring_events")
      .select("contestant_id")
      .eq("session_id", sessionId)
      .eq("episode", episode)
      .eq("action", PREDICTION_ACTION);
    if (!paidError) for (const r of paidRows || []) alreadyPaidIds.add(r.contestant_id);
    const alreadyPaidTeams = new Set([...alreadyPaidIds].map((id) => ownerOf.get(id)).filter(Boolean));
    const repaid = correctGuessers.filter((p) => alreadyPaidTeams.has(p.player_name)).map((p) => p.player_name);
    if (repaid.length > 0) {
      const again = await confirmDialog({
        title: `Points for ${actualVoteOut} were already given`,
        description:
          `${repaid.join(", ")} already got prediction points this episode for picking ${actualVoteOut}. ` +
          "Confirming again gives them a second time.",
        confirmText: "Give points again",
        cancelText: "Cancel",
      });
      if (!again) return;
    }

    // House rule: if everyone picked the same person, nobody gets points
    const everyoneSame = new Set(predictions.map((p) => p.predicted_winner)).size === 1;

    if (everyoneSame) {
      toast({
        title: "No points awarded",
        description: "Everyone predicted the same person - no points awarded!",
      });
    } else {
      const missed: string[] = [];
      for (const prediction of correctGuessers) {
        // Points go on one of the team's castaways: one still in (not the one going home tonight)
        // if there is one, otherwise any castaway on the team, so a team with nobody left still
        // gets its points
        const owned = allContestants.filter((c) => c.owner === prediction.player_name);
        const target =
          owned.find((c) => !c.isEliminated && c.name !== actualVoteOut) ??
          owned.find((c) => !c.isEliminated) ??
          owned[0];
        if (target) onScore(target.id, target.name, PREDICTION_ACTION, PREDICTION_POINTS);
        else missed.push(prediction.player_name);
      }

      const awarded = correctGuessers.length - missed.length;
      if (correctGuessers.length === 0) {
        toast({
          title: "No correct guesses",
          description: "No one predicted the vote out correctly",
        });
      } else if (awarded === 0) {
        toast({
          title: "No points given",
          description: `No castaways to give points to for: ${missed.join(", ")}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Points awarded",
          description:
            `${awarded} player(s) guessed correctly and earned ${PREDICTION_POINTS} points` +
            (missed.length ? `. No castaways to give points to for: ${missed.join(", ")}` : ""),
        });
      }
    }

    // Always mark who went home, even when nobody scored. Skip it if they're already out
    // (auto-scoring or a hand entry got there first) so they aren't voted out twice.
    const votedOutContestant = allContestants.find((c) => c.name === actualVoteOut);
    if (votedOutContestant && !votedOutContestant.isEliminated) {
      onScore(votedOutContestant.id, votedOutContestant.name, "Voted Out 💀", votedOutPoints);
    }

    setActualVoteOut("");
    onOpenChange(false);
  };

  const getPlayersWhoSubmitted = () => {
    return predictions.map(p => p.player_name);
  };

  const getMissingPlayers = () => {
    const submitted = getPlayersWhoSubmitted();
    return players.filter(p => !submitted.includes(p));
  };

  const isRevealed = predictions.length > 0 && predictions[0].is_revealed;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Final tribal council predictions</DialogTitle>
          <DialogDescription>
            Each player predicts who will be voted out. Correct guessers get {PREDICTION_POINTS} points - unless everyone picks the same person!
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Submission Status */}
          <div className="space-y-2">
            <h3 className="label-caps text-muted-foreground">Submission status</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {players.map((player) => {
                const hasSubmitted = getPlayersWhoSubmitted().includes(player);
                return (
                  <div key={player} className="glass flex min-h-[44px] items-center gap-2 rounded-[12px] px-3 py-2">
                    {hasSubmitted ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <Circle className="h-5 w-5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={`min-w-0 truncate ${hasSubmitted ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                      {player}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Prediction Form */}
          {!isRevealed && (
            <div className="plank space-y-4 p-4">
              <h3 className="label-caps text-muted-foreground">Submit prediction</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {isAdmin && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold">Player</label>
                    <Select value={selectedPlayer} onValueChange={(value) => setSelectedPlayer(value as Player)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select player" />
                      </SelectTrigger>
                      <SelectContent>
                        {players.map((player) => (
                          <SelectItem key={player} value={player}>
                            {player}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className={`space-y-2 ${!isAdmin ? 'sm:col-span-2' : ''}`}>
                  <label className="text-sm font-semibold">Predicted vote out</label>
                  <Select value={selectedWinner} onValueChange={setSelectedWinner}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select contestant" />
                    </SelectTrigger>
                    <SelectContent>
                      {finalists.map((contestant) => (
                        <SelectItem key={contestant.id} value={contestant.name}>
                          {contestant.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {!isAdmin && playerName && !getPlayersWhoSubmitted().includes(playerName as Player) && (
                <p className="text-sm text-muted-foreground">Submitting as: {playerName}</p>
              )}
              {!isAdmin && playerName && getPlayersWhoSubmitted().includes(playerName as Player) && (
                <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  You've already submitted your prediction
                </p>
              )}
              {!isAdmin && !playerName && (
                <p className="text-sm text-destructive">Your account is not assigned to a player. Contact an admin.</p>
              )}
              <Button 
                variant="accent"
                className="w-full sm:w-auto"
                onClick={() => {
                  if (!isAdmin && playerName) {
                    submitPrediction(playerName as Player);
                  } else {
                    submitPrediction();
                  }
                }} 
                disabled={
                  !selectedWinner || 
                  (isAdmin && !selectedPlayer) ||
                  (!isAdmin && (!playerName || getPlayersWhoSubmitted().includes(playerName as Player)))
                }
              >
                Submit prediction
              </Button>
            </div>
          )}

          {/* Revealed Predictions */}
          {isRevealed && (
            <div className="space-y-4">
              <div className="space-y-2">
                <h3 className="label-caps text-muted-foreground">Predictions</h3>
                <div className="space-y-2">
                  {predictions.map((prediction) => (
                    <div key={prediction.id} className="glass flex min-h-[44px] items-center justify-between gap-3 rounded-[12px] px-3 py-2">
                      <span className="font-semibold">{prediction.player_name}</span>
                      <span className="flex items-center gap-1.5 text-right text-muted-foreground">
                        {outThisEpisode.includes(prediction.predicted_winner) && (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Went home" />
                        )}
                        {prediction.predicted_winner}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {isAdmin && (
                <div className="space-y-3 rounded-[12px] border-2 border-accent bg-accent/10 p-4">
                  <h3 className="font-extrabold">Who actually got voted out?</h3>
                  {outThisEpisode.length > 0 && (
                    <p className="text-sm text-muted-foreground">
                      Already marked out this episode: {outThisEpisode.join(", ")}.
                      {pointsAlreadyGiven ? " Prediction points have been given." : ""}
                    </p>
                  )}
                  <Select value={actualVoteOut} onValueChange={setActualVoteOut}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select contestant" />
                    </SelectTrigger>
                    <SelectContent>
                      {/* Still in first, then anyone already marked out (auto-scoring may have done it) */}
                      {[...allContestants]
                        .sort((a, b) => Number(a.isEliminated) - Number(b.isEliminated) || a.name.localeCompare(b.name))
                        .map((contestant) => (
                          <SelectItem key={contestant.id} value={contestant.name}>
                            {contestant.isEliminated ? `${contestant.name} (already out)` : contestant.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button variant="accent" onClick={confirmVoteOut} disabled={!actualVoteOut} className="w-full">
                    Confirm & award points
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Admin Controls */}
          {isAdmin && (
            <div className="flex gap-2">
              {!isRevealed && predictions.length > 0 && (
                <Button onClick={revealAndScore} variant="default" className="w-full sm:w-auto">
                  Reveal & check predictions
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
