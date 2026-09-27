import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Player, Contestant, ScoringEvent, SCORING_ACTIONS } from "@/types/survivor";
import { ChevronUp, ChevronDown, Undo, Save, Plus, Minus, Search, ChevronRight, Grid3x3, List, Upload, User, Trophy, Scale, Flame, TreePalm, MoreHorizontal, Droplets, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FinalPredictionDialog } from "./FinalPredictionDialog";
import { getPoints, isActionEnabled, getCustomActions, CustomScoringAction, ScoringConfig } from "@/lib/scoring";
import { updateLastActive } from "@/lib/customerio";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { TeamAvatar } from "./TeamAvatar";
import { TeamAvatarUpload } from "./TeamAvatarUpload";
import { ContestantAvatar } from "./ContestantAvatar";
import { SeasonProgressBar } from "./SeasonProgressBar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
interface GameModeProps {
  leagueId?: string;
  currentUserId?: string;
  season: number;
  episode: number;
  isPostMerge: boolean;
  contestants: Contestant[];
  scoringEvents: ScoringEvent[];
  cryingThisEpisode: Set<string>;
  playerProfiles: Record<Player, { avatar?: string }>;
  scoringConfig?: ScoringConfig | null;
  draftOrder: Player[];
  isAdmin?: boolean;
  allowPlayerScoring?: boolean;
  playerName?: string | null;
  sessionId?: string;
  onEpisodeChange: (episode: number) => void;
  onTogglePostMerge: () => void;
  onAddScoringEvent: (contestantId: string, contestantName: string, action: string, points: number) => void;
  onUndo: () => void;
  onUndoEvent?: (eventId: string) => void;
  onExport: () => void;
  onUpdatePlayerAvatar: (player: Player, avatar: string) => void;
}

// Scoring event tiles (spec 03): 64px plank tile, label on top, points below in tabular numbers.
// Stacked rather than side by side so labels never collide with points in narrow 2-column grids.
const EVENT_BTN =
  "h-auto min-h-[64px] w-full flex-col items-start justify-center gap-1 whitespace-normal rounded-[12px] bg-muted/60 px-3 py-2 text-left text-sm font-semibold leading-tight hover:bg-muted";
const EVENT_BTN_SM = `${EVENT_BTN} min-h-[56px]`;
const EVENT_MORE_BTN = `${EVENT_BTN} flex-row items-center justify-between`;
const EVENT_PTS = "shrink-0 text-xl font-black leading-none tabular";

export const GameMode = ({
  leagueId,
  currentUserId,
  season,
  episode,
  isPostMerge,
  contestants,
  scoringEvents,
  cryingThisEpisode,
  playerProfiles,
  scoringConfig,
  draftOrder,
  isAdmin = false,
  allowPlayerScoring = false,
  playerName = null,
  sessionId,
  onEpisodeChange,
  onTogglePostMerge,
  onAddScoringEvent,
  onUndo,
  onUndoEvent,
  onExport,
  onUpdatePlayerAvatar,
}: GameModeProps) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterOwner, setFilterOwner] = useState<Player | "all">("all");
  const [showEliminated, setShowEliminated] = useState(true);
  const canScore = isAdmin || allowPlayerScoring;
  const [expandedContestant, setExpandedContestant] = useState<string | null>(null);
  const [expandedPlayers, setExpandedPlayers] = useState<Set<Player>>(new Set());
  const [scoringView, setScoringView] = useState<"team" | "all">("team");
  const [showPredictionDialog, setShowPredictionDialog] = useState(false);
  const [showJuryDialog, setShowJuryDialog] = useState(false);
  const [showSurvivorsDialog, setShowSurvivorsDialog] = useState(false);
  const { toast } = useToast();
  const isMobile = useIsMobile();
  
  // Get league teams for avatars
  const { teams, getMyTeam, updateTeam } = useLeagueTeams({ leagueId });
  
  // Get current user's team
  const myTeam = getMyTeam(currentUserId || null);
  
  // Map team names to their team data (id + avatar_url)
  const teamDataMap = useMemo(() => {
    const map: Record<string, { id: string; avatar_url: string | null }> = {};
    teams.forEach(team => {
      map[team.name] = { id: team.id, avatar_url: team.avatar_url || null };
    });
    return map;
  }, [teams]);
  
  // Get custom actions from scoring config
  const customActions = getCustomActions(scoringConfig);

  const handleAvatarUpload = (player: Player, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onUpdatePlayerAvatar(player, reader.result as string);
        toast({
          title: "Profile picture updated",
          description: `${player}'s avatar has been updated`,
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const togglePlayerExpanded = (player: Player) => {
    setExpandedPlayers((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(player)) {
        newSet.delete(player);
      } else {
        newSet.add(player);
      }
      return newSet;
    });
  };

  const getPlayerScore = (player: Player) => {
    const playerContestants = contestants.filter((c) => c.owner === player);
    const contestantIds = playerContestants.map((c) => c.id);
    return scoringEvents
      .filter((e) => contestantIds.includes(e.contestantId))
      .reduce((sum, e) => sum + e.points, 0);
  };

  const getPlayerScoreByEpisode = (player: Player, ep: number) => {
    const playerContestants = contestants.filter((c) => c.owner === player);
    const contestantIds = playerContestants.map((c) => c.id);
    return scoringEvents
      .filter((e) => contestantIds.includes(e.contestantId) && e.episode === ep)
      .reduce((sum, e) => sum + e.points, 0);
  };

  const teamCount = draftOrder.length || 4;
  const picksPerTeam = Math.ceil(contestants.filter(c => c.owner).length / teamCount) || 4;

  const leaderboard = draftOrder
    .map((player) => ({
      player,
      score: getPlayerScore(player),
      activeCount: contestants.filter((c) => c.owner === player && !c.isEliminated).length,
    }))
    .sort((a, b) => b.score - a.score);

  // Generate dynamic colors for teams
  const getTeamColor = (index: number) => {
    // Deep Jungle tokens only: canopy, clay, fern, sun, lichen
    const colors = [
      "border-l-primary",
      "border-l-accent",
      "border-l-success",
      "border-l-warning",
      "border-l-muted-foreground",
      "border-l-primary",
      "border-l-accent",
      "border-l-success",
    ];
    return colors[index % colors.length];
  };

  const getTeamColorByName = (player: Player | undefined) => {
    if (!player) return "";
    const index = draftOrder.indexOf(player);
    return index >= 0 ? getTeamColor(index) : "";
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 0: return "🥇";
      case 1: return "🥈";
      case 2: return "🥉";
      default: return "4️⃣";
    }
  };

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 0: return "border-gold bg-gold/10";
      case 1: return "border-silver bg-silver/10";
      case 2: return "border-bronze bg-bronze/10";
      default: return "border-muted";
    }
  };

  const getPlayerContestants = (player: Player) => {
    return contestants
      .filter((c) => c.owner === player)
      .sort((a, b) => (a.pickNumber || 0) - (b.pickNumber || 0));
  };

  const getContestantScore = (contestantId: string) => {
    return scoringEvents
      .filter((e) => e.contestantId === contestantId)
      .reduce((sum, e) => sum + e.points, 0);
  };

  const filteredContestants = contestants.filter((c) => {
    if (!showEliminated && c.isEliminated) return false;
    if (filterOwner !== "all" && c.owner !== filterOwner) return false;
    if (searchTerm && !c.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const contestantsByOwner = draftOrder.map((player) => ({
    player,
    contestants: filteredContestants.filter((c) => c.owner === player),
  }));

  const episodeEvents = scoringEvents.filter((e) => e.episode === episode);

  const handleQuickScore = (contestant: Contestant, action: string, points: number) => {
    if (action.includes("Cry") && cryingThisEpisode.has(contestant.id)) {
      toast({
        title: "Already cried this episode",
        description: `${contestant.name} already cried this episode (limit 1)`,
        variant: "destructive",
      });
      return;
    }

    onAddScoringEvent(contestant.id, contestant.name, action, points);
    if (currentUserId) updateLastActive(currentUserId);
    toast({
      title: points > 0 ? "Points added" : "Points deducted",
      description: `${contestant.name}: ${action} (${points > 0 ? "+" : ""}${points})`,
    });
  };

  const survivePoints = isPostMerge 
    ? getPoints("SURVIVE_POST", scoringConfig) 
    : getPoints("SURVIVE_PRE", scoringConfig);
  const surviveAction = isPostMerge
    ? SCORING_ACTIONS.SURVIVE_POST
    : SCORING_ACTIONS.SURVIVE_PRE;

  // Helper: Get contestants eligible for jury points (non-eliminated, owned, no existing Make Jury event)
  const getContestantsForJuryPoints = () => {
    const alreadyAwarded = new Set(
      scoringEvents
        .filter(e => e.action === SCORING_ACTIONS.MAKE_JURY.label)
        .map(e => e.contestantId)
    );
    return contestants.filter(c => 
      !c.isEliminated && 
      c.owner && 
      !alreadyAwarded.has(c.id)
    );
  };

  // Helper: Get contestants eligible for survival points this episode
  const getContestantsForSurvivalPoints = () => {
    const surviveLabel = isPostMerge 
      ? SCORING_ACTIONS.SURVIVE_POST.label 
      : SCORING_ACTIONS.SURVIVE_PRE.label;
    
    const alreadyAwarded = new Set(
      scoringEvents
        .filter(e => e.episode === episode && e.action === surviveLabel)
        .map(e => e.contestantId)
    );
    
    return contestants.filter(c => 
      !c.isEliminated && 
      c.owner && 
      !alreadyAwarded.has(c.id)
    );
  };

  // Handler: Award jury points to all eligible contestants
  const handleAwardAllJuryPoints = () => {
    const eligible = getContestantsForJuryPoints();
    const points = getPoints("MAKE_JURY", scoringConfig);
    
    for (const contestant of eligible) {
      onAddScoringEvent(contestant.id, contestant.name, SCORING_ACTIONS.MAKE_JURY.label, points);
    }
    
    toast({
      title: "Jury points awarded",
      description: `Awarded ${points} points to ${eligible.length} contestant(s)`,
    });
    
    setShowJuryDialog(false);
  };

  // Handler: Award survival points to all eligible contestants
  const handleAwardAllSurvivalPoints = () => {
    const eligible = getContestantsForSurvivalPoints();
    const actionKey = isPostMerge ? "SURVIVE_POST" : "SURVIVE_PRE";
    const action = SCORING_ACTIONS[actionKey];
    const points = getPoints(actionKey, scoringConfig);
    
    for (const contestant of eligible) {
      onAddScoringEvent(contestant.id, contestant.name, action.label, points);
    }
    
    toast({
      title: "Survival points awarded",
      description: `Awarded ${points} points to ${eligible.length} contestant(s)`,
    });
    
    setShowSurvivorsDialog(false);
  };

  return (
    <TooltipProvider>
    <div className="container max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="plank p-4 md:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-4xl md:text-5xl leading-none text-primary">
              Season {season}
            </h2>
          </div>

          {/* Mobile Layout */}
          {isMobile ? (
            <div className="flex flex-col gap-2 w-full">
              {/* Row 1: Episode stepper + phase chip */}
              <div className="flex items-center gap-2 w-full">
                <div className="flex h-12 items-center rounded-full border-2 border-plank bg-background">
                  <Button
                    onClick={() => isAdmin && onEpisodeChange(Math.max(1, episode - 1))}
                    size="icon"
                    variant="ghost"
                    disabled={!isAdmin}
                    aria-label="Previous episode"
                    className={`rounded-full ${!isAdmin ? "cursor-not-allowed" : ""}`}
                  >
                    <Minus className="h-4 w-4" />
                  </Button>
                  <span className="min-w-[4rem] text-center text-lg font-black tabular">Ep {episode}</span>
                  <Button
                    onClick={() => isAdmin && onEpisodeChange(episode + 1)}
                    size="icon"
                    variant="ghost"
                    disabled={!isAdmin}
                    aria-label="Next episode"
                    className={`rounded-full ${!isAdmin ? "cursor-not-allowed" : ""}`}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => isAdmin && onTogglePostMerge()}
                      variant="outline"
                      disabled={!isAdmin}
                      className="h-11 rounded-full px-3"
                    >
                      {isPostMerge ? <Flame className="text-accent" /> : <TreePalm className="text-success" />}
                      {isPostMerge ? "Post-merge" : "Pre-merge"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Toggle between pre-merge (+5) and post-merge (+10) survival points</TooltipContent>
                </Tooltip>
              </div>

              {/* Row 2: Tribal + Actions dropdown (admin) or icon buttons (non-admin) */}
              <div className="flex items-center gap-2 w-full">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="accent"
                      onClick={() => setShowPredictionDialog(true)}
                      className="flex-1 px-4"
                    >
                      <Trophy className="h-4 w-4" />
                      Tribal prediction
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Submit predictions and vote out contestants at tribal council</TooltipContent>
                </Tooltip>

                {isAdmin && (
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="outline" aria-label="Admin actions">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Admin actions menu</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" className="z-50 min-w-[14rem] rounded-[12px] border-2 border-plank bg-popover p-1 shadow-md">
                      <DropdownMenuItem onClick={() => setShowSurvivorsDialog(true)} className="min-h-[44px] gap-2 rounded-[8px] font-semibold">
                        {isPostMerge ? <Flame className="h-4 w-4 text-accent" /> : <TreePalm className="h-4 w-4 text-success" />}
                        Mark all survived
                      </DropdownMenuItem>
                      {isPostMerge && isActionEnabled("MAKE_JURY", scoringConfig) && (
                        <DropdownMenuItem onClick={() => setShowJuryDialog(true)} className="min-h-[44px] gap-2 rounded-[8px] font-semibold">
                          <Scale className="h-4 w-4 text-muted-foreground" />
                          Award jury points
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={onUndo} className="min-h-[44px] gap-2 rounded-[8px] font-semibold">
                        <Undo className="h-4 w-4 text-muted-foreground" />
                        Undo last action
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={onExport} className="min-h-[44px] gap-2 rounded-[8px] font-semibold">
                        <Save className="h-4 w-4 text-muted-foreground" />
                        Export game data
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {!isAdmin && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="outline" onClick={onUndo} aria-label="Undo last scoring action">
                          <Undo className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Undo last scoring action</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="outline" onClick={onExport} aria-label="Export game data">
                          <Save className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export game data</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
            </div>
          ) : (
            /* Desktop Layout */
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-12 items-center rounded-full border-2 border-plank bg-background">
                <Button
                  onClick={() => isAdmin && onEpisodeChange(Math.max(1, episode - 1))}
                  size="icon"
                  variant="ghost"
                  disabled={!isAdmin}
                  aria-label="Previous episode"
                  className={`rounded-full ${!isAdmin ? "cursor-not-allowed" : ""}`}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="min-w-[4.5rem] text-center text-lg font-black tabular">Ep {episode}</span>
                <Button
                  onClick={() => isAdmin && onEpisodeChange(episode + 1)}
                  size="icon"
                  variant="ghost"
                  disabled={!isAdmin}
                  aria-label="Next episode"
                  className={`rounded-full ${!isAdmin ? "cursor-not-allowed" : ""}`}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => isAdmin && onTogglePostMerge()}
                    variant="outline"
                    disabled={!isAdmin}
                    className="rounded-full px-4"
                  >
                    {isPostMerge ? <Flame className="text-accent" /> : <TreePalm className="text-success" />}
                    {isPostMerge ? "Post-merge" : "Pre-merge"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle between pre-merge (+5) and post-merge (+10) survival points</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => setShowPredictionDialog(true)}
                    variant="accent"
                  >
                    <Trophy className="h-4 w-4" />
                    Tribal prediction
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Submit predictions and vote out contestants at tribal council</TooltipContent>
              </Tooltip>

              {/* Bulk Survival Points Button - Admin only (opens the shared dialog below) */}
              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={() => setShowSurvivorsDialog(true)}>
                      {isPostMerge ? <Flame className="h-4 w-4 text-accent" /> : <TreePalm className="h-4 w-4 text-success" />}
                      Mark survivors
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Award survival points to all remaining contestants this episode</TooltipContent>
                </Tooltip>
              )}

              {/* Bulk Jury Points Button - Admin only, post-merge only (opens the shared dialog below) */}
              {isAdmin && isPostMerge && isActionEnabled("MAKE_JURY", scoringConfig) && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={() => setShowJuryDialog(true)}>
                      <Scale className="h-4 w-4" />
                      Award jury
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Award +50 jury points to all surviving contestants</TooltipContent>
                </Tooltip>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={onUndo} variant="outline" size="icon" aria-label="Undo last scoring action">
                    <Undo className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Undo last scoring action</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button onClick={onExport} variant="outline" size="icon" aria-label="Export game data">
                    <Save className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export game data</TooltipContent>
              </Tooltip>
            </div>
          )}
        </div>

        {/* Season Progress */}
        <SeasonProgressBar
          episode={episode}
          isPostMerge={isPostMerge}
          contestants={contestants}
        />
      </div>

      {/* The one copy of each bulk-award dialog (opened from the desktop buttons and the phone menu) */}
      <AlertDialog open={showSurvivorsDialog} onOpenChange={setShowSurvivorsDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Award survival points</AlertDialogTitle>
            <AlertDialogDescription>
              Award {survivePoints} points ({isPostMerge ? "post-merge" : "pre-merge"}) to all surviving, owned contestants for Episode {episode}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto space-y-1.5 my-4">
            {getContestantsForSurvivalPoints().map(c => (
              <div key={c.id} className="glass flex min-h-[40px] items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm">
                <span className="font-semibold">{c.name}</span>
                <span className="text-muted-foreground">{c.owner}</span>
              </div>
            ))}
            {getContestantsForSurvivalPoints().length === 0 && (
              <p className="text-muted-foreground text-center py-4">All contestants already awarded this episode</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAwardAllSurvivalPoints}
              disabled={getContestantsForSurvivalPoints().length === 0}
            >
              Award {getContestantsForSurvivalPoints().length} contestant(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showJuryDialog} onOpenChange={setShowJuryDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Award jury points</AlertDialogTitle>
            <AlertDialogDescription>
              Award {getPoints("MAKE_JURY", scoringConfig)} points to all surviving, owned contestants who haven't already received jury points.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-48 overflow-y-auto space-y-1.5 my-4">
            {getContestantsForJuryPoints().map(c => (
              <div key={c.id} className="glass flex min-h-[40px] items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm">
                <span className="font-semibold">{c.name}</span>
                <span className="text-muted-foreground">{c.owner}</span>
              </div>
            ))}
            {getContestantsForJuryPoints().length === 0 && (
              <p className="text-muted-foreground text-center py-4">No eligible contestants</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleAwardAllJuryPoints}
              disabled={getContestantsForJuryPoints().length === 0}
            >
              Award {getContestantsForJuryPoints().length} contestant(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Final Prediction Dialog */}
      {sessionId && (
        <FinalPredictionDialog
          open={showPredictionDialog}
          onOpenChange={setShowPredictionDialog}
          sessionId={sessionId}
          episode={episode}
          finalists={contestants.filter(c => !c.isEliminated)}
          isAdmin={isAdmin}
          playerName={playerName}
          players={draftOrder}
          onScore={onAddScoringEvent}
        />
      )}

      {/* Leaderboard */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {leaderboard.map((entry, index) => {
          const playerContestants = getPlayerContestants(entry.player);
          const isExpanded = expandedPlayers.has(entry.player);

          return (
            <Card
              key={entry.player}
              className="overflow-hidden"
            >
              <Collapsible open={isExpanded} onOpenChange={() => togglePlayerExpanded(entry.player)}>
                <div className="p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-lg font-black tabular ${
                        index === 0
                          ? "bg-warning text-warning-foreground border-2 border-plank"
                          : "text-primary"
                      }`}
                      aria-label={`Rank ${index + 1}`}
                    >
                      {index + 1}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {picksPerTeam <= 8 &&
                        Array.from({ length: picksPerTeam }, (_, i) => (
                          <span
                            key={i}
                            aria-hidden="true"
                            className={`h-2.5 w-2.5 rounded-full ${
                              i < entry.activeCount ? "bg-success" : "border-[1.5px] border-input"
                            }`}
                          />
                        ))}
                      <span className="ml-1 text-xs font-semibold text-muted-foreground">
                        {entry.activeCount}/{picksPerTeam} active
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="relative group">
                      {/* Show upload component for user's own team, static avatar for others */}
                      {myTeam?.name === entry.player && teamDataMap[entry.player] ? (
                        <TeamAvatarUpload
                          teamId={teamDataMap[entry.player].id}
                          leagueId={leagueId || ''}
                          currentAvatarUrl={teamDataMap[entry.player].avatar_url}
                          teamName={String(entry.player)}
                          onUploadComplete={(url) => updateTeam(teamDataMap[entry.player].id, { avatar_url: url })}
                          size="md"
                        />
                      ) : (
                        <>
                          {/* Priority: team avatar from league_teams, then playerProfiles, then themed fallback */}
                          {teamDataMap[entry.player]?.avatar_url || !playerProfiles?.[entry.player]?.avatar ? (
                            <TeamAvatar 
                              teamName={String(entry.player)} 
                              avatarUrl={teamDataMap[entry.player]?.avatar_url} 
                              size="lg"
                              className="border-2 border-border"
                            />
                          ) : (
                            <img 
                              src={playerProfiles[entry.player].avatar} 
                              alt={entry.player}
                              className="w-16 h-16 rounded-full object-cover border-2 border-border"
                            />
                          )}
                        </>
                      )}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <h3 className="font-display text-2xl leading-[0.95] break-words">{entry.player}</h3>
                      <div className="mt-1 flex items-baseline gap-2">
                        <p className="text-4xl font-black tracking-tight tabular">{entry.score}</p>
                        {(() => {
                          const epPts = getPlayerScoreByEpisode(entry.player, episode);
                          return epPts !== 0 ? (
                            <span className="text-sm font-bold text-success tabular">
                              {epPts > 0 ? "+" : ""}
                              {epPts} ep {episode}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  </div>
                  
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full mt-2 h-11 text-sm">
                      {isExpanded ? (
                        <>
                          <ChevronUp className="h-4 w-4 mr-2" />
                          Hide team
                        </>
                      ) : (
                        <>
                          <ChevronRight className="h-4 w-4 mr-2" />
                          Show team
                        </>
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent>
                  <div className="px-5 pb-5 space-y-4">
                    {/* Episode Breakdown */}
                    <div className="glass p-3 rounded-[12px]">
                      <h4 className="label-caps mb-2 text-muted-foreground">Episode scores</h4>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        {Array.from({ length: episode }, (_, i) => i + 1).map((ep) => {
                          const epScore = getPlayerScoreByEpisode(entry.player, ep);
                          return (
                            <div
                              key={ep}
                              className={`p-2 rounded-[10px] ${
                                ep === episode ? 'bg-accent/15 border-2 border-accent' : 'bg-muted/60'
                              }`}
                            >
                              <div className="font-semibold">Ep {ep}</div>
                              <div className="text-success font-extrabold tabular">
                                {epScore > 0 && '+'}
                                {epScore}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Team Roster */}
                    <div className="space-y-2">
                      {playerContestants.map((contestant) => {
                        const contestantScore = getContestantScore(contestant.id);
                        return (
                          <div
                            key={contestant.id}
                            className={`glass p-3 rounded-[12px] transition-opacity ${
                              contestant.isEliminated ? "opacity-70" : ""
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="xs" isEliminated={contestant.isEliminated} />
                                <div className="flex-1 min-w-0">
                                  <p className={`font-semibold text-sm truncate ${contestant.isEliminated ? "line-through text-muted-foreground" : ""}`}>{contestant.name}</p>
                                  <p className="text-xs text-muted-foreground">
                                    Pick #{contestant.pickNumber}
                                    {contestant.tribe && ` • ${contestant.tribe}`}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                {contestant.isEliminated && (
                                  <span className="rounded-full bg-destructive px-2 py-0.5 text-[11px] font-extrabold text-destructive-foreground">
                                    Out
                                  </span>
                                )}
                                <span className="text-sm font-extrabold tabular">{contestantScore} pts</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          );
        })}
      </div>

      {/* Filters */}
      <div className="glass rounded-[12px] p-3">
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search contestants..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value as Player | "all")}
            className="h-11 rounded-[10px] border-2 border-input bg-card px-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All teams</option>
            {draftOrder.map((player) => (
              <option key={player} value={player}>{player}</option>
            ))}
          </select>

          <Button
            onClick={() => setShowEliminated(!showEliminated)}
            variant={showEliminated ? "default" : "outline"}
          >
            {showEliminated ? "Hide" : "Show"} eliminated
          </Button>
        </div>
      </div>

      {/* Scoring Section - Grouped by Player */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-3xl leading-none text-primary">Score this episode</h2>

          <div className="glass flex items-center gap-1 rounded-full p-1">
            <Button
              onClick={() => setScoringView("team")}
              variant={scoringView === "team" ? "default" : "ghost"}
              aria-pressed={scoringView === "team"}
              className="h-11 rounded-full px-4"
            >
              <Grid3x3 className="h-4 w-4" />
              Team view
            </Button>
            <Button
              onClick={() => setScoringView("all")}
              variant={scoringView === "all" ? "default" : "ghost"}
              aria-pressed={scoringView === "all"}
              className="h-11 rounded-full px-4"
            >
              <List className="h-4 w-4" />
              All players
            </Button>
          </div>
        </div>
        
        {scoringView === "team" ? (
          contestantsByOwner.map(({ player, contestants: playerContestants }) => (
            playerContestants.length > 0 && (
            <Card key={player} className={`overflow-hidden border-l-4 ${getTeamColorByName(player)}`}>
              <div className="p-4 md:p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-display text-2xl leading-none break-words">{player}'s team</h3>
                  <span className="glass inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold">
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-success" />
                    <span className="tabular">{playerContestants.filter(c => !c.isEliminated).length}</span> active
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {playerContestants.map((contestant) => {
                    const isExpanded = expandedContestant === contestant.id;
                    const canCry = !cryingThisEpisode.has(contestant.id);

                    return (
                      <Card
                        key={contestant.id}
                        className={`space-y-3 rounded-[12px] border-[1.5px] border-border p-3 ${
                          contestant.isEliminated ? "bg-muted/50" : ""
                        }`}
                      >
                        {/* Castaway row: fern dot when still in, clay "Out" pill when voted out */}
                        <div className="flex items-center gap-3">
                          <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="md" isEliminated={contestant.isEliminated} className="shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {contestant.isEliminated ? (
                                <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-extrabold text-destructive-foreground">
                                  Out
                                </span>
                              ) : (
                                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
                              )}
                              <h4 className={`truncate text-base font-extrabold ${contestant.isEliminated ? "line-through text-muted-foreground" : ""}`}>{contestant.name}</h4>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                              {contestant.age && <span>Age: {contestant.age}</span>}
                              {contestant.location && <span className="truncate">{contestant.location}</span>}
                              {contestant.tribe && <span>Tribe: {contestant.tribe}</span>}
                              <span>Pick #{contestant.pickNumber}</span>
                            </div>
                          </div>
                        </div>

                        {/* Scoring events: 2-column, 64px tiles */}
                        <div className={`grid grid-cols-2 gap-2 ${canScore ? "" : "hidden"}`}>
                          {canScore && !contestant.isEliminated && (
                            <Button
                              onClick={() => handleQuickScore(contestant, surviveAction.label, survivePoints)}
                              variant="outline"
                              className={EVENT_BTN}
                            >
                              <span className="flex items-center gap-1.5">
                                {isPostMerge ? <Flame className="text-accent" /> : <TreePalm className="text-success" />}
                                Survive
                              </span>
                              <span className={`${EVENT_PTS} text-success`}>+{survivePoints}</span>
                            </Button>
                          )}
                          {isActionEnabled("WIN_IMMUNITY", scoringConfig) && (
                            <Button
                              onClick={() =>
                                handleQuickScore(
                                  contestant,
                                  SCORING_ACTIONS.WIN_IMMUNITY.label,
                                  getPoints("WIN_IMMUNITY", scoringConfig)
                                )
                              }
                              variant="outline"
                              className={EVENT_BTN}
                            >
                              <span className="flex items-center gap-1.5">
                                <Trophy className="text-muted-foreground" />
                                Immunity
                              </span>
                              <span className={`${EVENT_PTS} text-success`}>+{getPoints("WIN_IMMUNITY", scoringConfig)}</span>
                            </Button>
                          )}
                          {canCry && isActionEnabled("CRY", scoringConfig) && (
                            <Button
                              onClick={() => handleQuickScore(contestant, SCORING_ACTIONS.CRY.label, getPoints("CRY", scoringConfig))}
                              variant="outline"
                              className={EVENT_BTN}
                            >
                              <span className="flex items-center gap-1.5">
                                <Droplets className="text-muted-foreground" />
                                Cry
                              </span>
                              <span className={`${EVENT_PTS} text-success`}>+{getPoints("CRY", scoringConfig)}</span>
                            </Button>
                          )}
                          <Button
                            onClick={() => setExpandedContestant(isExpanded ? null : contestant.id)}
                            variant="outline"
                            aria-expanded={isExpanded}
                            className={EVENT_MORE_BTN}
                          >
                            <span>More</span>
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>

                        {/* Expanded Menu */}
                        {canScore && isExpanded && (
                          <div className="grid grid-cols-2 gap-2 border-t-2 border-border pt-3 animate-in slide-in-from-top">
                            {Object.entries(SCORING_ACTIONS).map(([key, action]) => {
                              if (key === "SURVIVE_PRE" || key === "SURVIVE_POST" || key === "VOTED_OUT" || key === "CRY") return null;
                              if (!isActionEnabled(key, scoringConfig)) return null;
                              const points = getPoints(key, scoringConfig);
                              return (
                                <Button
                                  key={key}
                                  onClick={() =>
                                    handleQuickScore(contestant, action.label, points)
                                  }
                                  variant="outline"
                                  className={EVENT_BTN_SM}
                                >
                                  <span className="min-w-0 break-words">{action.label}</span>
                                  <span className={`${EVENT_PTS} ${points > 0 ? "text-success" : "text-destructive"}`}>
                                    {points > 0 ? "+" : ""}
                                    {points}
                                  </span>
                                </Button>
                              );
                            })}
                            {/* Custom Actions */}
                            {customActions.length > 0 && (
                              <>
                                <div className="col-span-2 pt-1">
                                  <span className="label-caps text-muted-foreground">Custom</span>
                                </div>
                                {customActions.map((action) => (
                                  <Button
                                    key={action.id}
                                    onClick={() =>
                                      handleQuickScore(contestant, `${action.label} ${action.emoji}`, action.points)
                                    }
                                    variant="outline"
                                    className={EVENT_BTN_SM}
                                  >
                                    <span className="min-w-0 break-words">{action.emoji} {action.label}</span>
                                    <span className={`${EVENT_PTS} ${action.points > 0 ? "text-success" : "text-destructive"}`}>
                                      {action.points > 0 ? "+" : ""}
                                      {action.points}
                                    </span>
                                  </Button>
                                ))}
                              </>
                            )}
                          </div>
                        )}

                        {isAdmin && !contestant.isEliminated && (
                          <Button
                            onClick={() => {
                              if (!confirm(`Mark ${contestant.name} as voted out?`)) return;
                              handleQuickScore(contestant, SCORING_ACTIONS.VOTED_OUT.label, getPoints("VOTED_OUT", scoringConfig));
                            }}
                            variant="outline"
                            className="h-12 w-full rounded-[12px] border-destructive text-base font-extrabold text-destructive hover:bg-destructive hover:text-destructive-foreground"
                          >
                            Voted out
                          </Button>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </div>
            </Card>
            )
          ))
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredContestants.filter(c => c.owner).map((contestant) => {
              const isExpanded = expandedContestant === contestant.id;
              const canCry = !cryingThisEpisode.has(contestant.id);

              return (
                <Card
                  key={contestant.id}
                  className={`space-y-3 p-4 border-l-4 ${getTeamColorByName(contestant.owner)} ${
                    contestant.isEliminated ? "bg-muted/50" : ""
                  }`}
                >
                  {/* Castaway row: fern dot when still in, clay "Out" pill when voted out */}
                  <div className="flex items-center gap-3">
                    <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="md" isEliminated={contestant.isEliminated} className="shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {contestant.isEliminated ? (
                          <span className="shrink-0 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-extrabold text-destructive-foreground">
                            Out
                          </span>
                        ) : (
                          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-success" />
                        )}
                        <h4 className={`truncate text-base font-extrabold ${contestant.isEliminated ? "line-through text-muted-foreground" : ""}`}>{contestant.name}</h4>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {contestant.age && <span>Age: {contestant.age}</span>}
                        {contestant.location && <span className="truncate">{contestant.location}</span>}
                        {contestant.tribe && <span>Tribe: {contestant.tribe}</span>}
                        <span>{contestant.owner} • Pick #{contestant.pickNumber}</span>
                      </div>
                    </div>
                  </div>

                  {/* Scoring events: 2-column, 64px tiles */}
                  <div className={`grid grid-cols-2 gap-2 ${canScore ? "" : "hidden"}`}>
                    {canScore && !contestant.isEliminated && (
                      <Button
                        onClick={() => handleQuickScore(contestant, surviveAction.label, survivePoints)}
                        variant="outline"
                        className={EVENT_BTN}
                      >
                        <span className="flex items-center gap-1.5">
                          {isPostMerge ? <Flame className="text-accent" /> : <TreePalm className="text-success" />}
                          Survive
                        </span>
                        <span className={`${EVENT_PTS} text-success`}>+{survivePoints}</span>
                      </Button>
                    )}
                    {isActionEnabled("WIN_IMMUNITY", scoringConfig) && (
                      <Button
                        onClick={() =>
                          handleQuickScore(
                            contestant,
                            SCORING_ACTIONS.WIN_IMMUNITY.label,
                            getPoints("WIN_IMMUNITY", scoringConfig)
                          )
                        }
                        variant="outline"
                        className={EVENT_BTN}
                      >
                        <span className="flex items-center gap-1.5">
                          <Trophy className="text-muted-foreground" />
                          Immunity
                        </span>
                        <span className={`${EVENT_PTS} text-success`}>+{getPoints("WIN_IMMUNITY", scoringConfig)}</span>
                      </Button>
                    )}
                    {canCry && isActionEnabled("CRY", scoringConfig) && (
                      <Button
                        onClick={() => handleQuickScore(contestant, SCORING_ACTIONS.CRY.label, getPoints("CRY", scoringConfig))}
                        variant="outline"
                        className={EVENT_BTN}
                      >
                        <span className="flex items-center gap-1.5">
                          <Droplets className="text-muted-foreground" />
                          Cry
                        </span>
                        <span className={`${EVENT_PTS} text-success`}>+{getPoints("CRY", scoringConfig)}</span>
                      </Button>
                    )}
                    <Button
                      onClick={() => setExpandedContestant(isExpanded ? null : contestant.id)}
                      variant="outline"
                      aria-expanded={isExpanded}
                      className={EVENT_MORE_BTN}
                    >
                      <span>More</span>
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>

                  {/* Expanded Menu */}
                  {canScore && isExpanded && (
                    <div className="grid grid-cols-2 gap-2 border-t-2 border-border pt-3 animate-in slide-in-from-top">
                      {Object.entries(SCORING_ACTIONS).map(([key, action]) => {
                        if (key === "SURVIVE_PRE" || key === "SURVIVE_POST" || key === "VOTED_OUT" || key === "CRY") return null;
                        if (!isActionEnabled(key, scoringConfig)) return null;
                        const points = getPoints(key, scoringConfig);
                        return (
                          <Button
                            key={key}
                            onClick={() =>
                              handleQuickScore(contestant, action.label, points)
                            }
                            variant="outline"
                            className={EVENT_BTN_SM}
                          >
                            <span className="min-w-0 break-words">{action.label}</span>
                            <span className={`${EVENT_PTS} ${points > 0 ? "text-success" : "text-destructive"}`}>
                              {points > 0 ? "+" : ""}
                              {points}
                            </span>
                          </Button>
                        );
                      })}
                      {/* Custom Actions */}
                      {customActions.length > 0 && (
                        <>
                          <div className="col-span-2 pt-1">
                            <span className="label-caps text-muted-foreground">Custom</span>
                          </div>
                          {customActions.map((action) => (
                            <Button
                              key={action.id}
                              onClick={() =>
                                handleQuickScore(contestant, `${action.label} ${action.emoji}`, action.points)
                              }
                              variant="outline"
                              className={EVENT_BTN_SM}
                            >
                              <span className="min-w-0 break-words">{action.emoji} {action.label}</span>
                              <span className={`${EVENT_PTS} ${action.points > 0 ? "text-success" : "text-destructive"}`}>
                                {action.points > 0 ? "+" : ""}
                                {action.points}
                              </span>
                            </Button>
                          ))}
                        </>
                      )}
                    </div>
                  )}

                  {isAdmin && !contestant.isEliminated && (
                    <Button
                      onClick={() => {
                        if (!confirm(`Mark ${contestant.name} as voted out?`)) return;
                        handleQuickScore(contestant, SCORING_ACTIONS.VOTED_OUT.label, getPoints("VOTED_OUT", scoringConfig));
                      }}
                      variant="outline"
                      className="h-12 w-full rounded-[12px] border-destructive text-base font-extrabold text-destructive hover:bg-destructive hover:text-destructive-foreground"
                    >
                      Voted out
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Episode Log */}
      <Card className="p-4 md:p-6 space-y-3">
        <h2 className="font-display text-3xl leading-none">Episode {episode} events</h2>
        
        {episodeEvents.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No points scored yet this episode. Use the buttons above to score actions.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto divide-y-[1.5px] divide-border">
            {[...episodeEvents].reverse().map((event) => (
              <li
                key={event.id}
                className="flex min-h-[52px] items-center gap-3 py-1.5"
              >
                <span
                  className={`w-12 shrink-0 text-lg font-black tabular ${
                    event.points > 0 ? "text-success" : event.points < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {event.points > 0 ? "+" : ""}
                  {event.points}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="truncate font-bold">{event.contestantName}</p>
                  <p className="truncate text-sm text-muted-foreground">{event.action}</p>
                </div>
                {onUndoEvent && (
                  <Button
                    onClick={() => {
                      onUndoEvent(event.id);
                      toast({
                        title: "Event removed",
                        description: `Removed: ${event.contestantName} - ${event.action}`,
                      });
                    }}
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${event.contestantName}: ${event.action}`}
                    className="shrink-0 rounded-full border-[1.5px] border-border"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
    </TooltipProvider>
  );
};
