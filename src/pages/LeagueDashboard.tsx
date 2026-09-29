import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useGameStateDB } from "@/hooks/useGameStateDB";
import { useAuth } from "@/hooks/useAuth";
import { useLeagueRole } from "@/hooks/useLeagueRole";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { useIsSuperAdmin } from "@/hooks/useIsSuperAdmin";
import { supabase } from "@/integrations/supabase/client";
import { DraftMode } from "@/components/DraftMode";
import { GameMode } from "@/components/GameMode";
import { HistoryMode } from "@/components/HistoryMode";
import { AdminPanel } from "@/components/AdminPanel";
import { CommissionerChecklist } from "@/components/CommissionerChecklist";
import { OnboardingTour } from "@/components/OnboardingTour";
import { GameplayTips } from "@/components/GameplayTips";
import { EpisodeResultsCard } from "@/components/EpisodeResultsCard";
import { draftPoolSize, getPicksPerTeam } from "@/lib/picksPerTeam";
import { LateStartCard } from "@/components/StartEpisodePicker";
import { LeagueInfo } from "@/components/LeagueInfo";
import { SeasonCompleteBanner, NewSeasonDialog } from "@/components/SeasonCompleteBanner";
import { Lockup } from "@/components/Lockup";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useIsMobile } from "@/hooks/use-mobile";
import { WinnerTakesAllMode } from "@/components/WinnerTakesAllMode";
import { NewsFeed } from "@/components/NewsFeed";
import { LeagueChat } from "@/components/LeagueChat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trophy, History, Users, Shield, LogOut, ArrowLeft, Target, ClipboardList, Info, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { updateLastActive, trackEvent } from "@/lib/customerio";

type ViewMode = "draft" | "game" | "history" | "league" | "admin";

const LeagueDashboard = () => {
  const { id: leagueId } = useParams<{ id: string }>();
  const [leagueName, setLeagueName] = useState<string>("");
  const [leagueLoading, setLeagueLoading] = useState(true);
  const [allowPlayerScoring, setAllowPlayerScoring] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("draft"); // will be corrected by effect
  const isMobile = useIsMobile();
  const [newSeasonOpen, setNewSeasonOpen] = useState(false);
  // Season numbers are frozen when the dialog opens so the text doesn't change mid-click
  const [rollover, setRollover] = useState<{
    from: number;
    to: number;
    hasDraft: boolean;
    castPreview: string;
  }>({ from: 0, to: 0, hasDraft: false, castPreview: "" });
  const { settings: appSettings } = useAppSettings();
  const [looksLikeNewCast, setLooksLikeNewCast] = useState(false);
  const [castCheckPending, setCastCheckPending] = useState(false);

  const {
    state,
    loading: gameLoading,
    sessionId,
    sessionStatus,
    scoringConfig,
    setScoringConfig,
    setMode,
    setSeason,
    setEpisode,
    togglePostMerge,
    addContestant,
    updateContestant,
    deleteContestant,
    setContestants,
    randomizeDraftOrder,
    setDraftOrder,
    setDraftType,
    draftContestant,
    undoDraftPick,
    setGameType,
    setPicksPerTeam,
    addScoringEvent,
    undoLastEvent,
    undoEvent,
    applyEpisodeResults,
    undoEpisodeResults,
    exportData,
    importData,
    startNewSeason,
    importOfficialCast,
    revertToSetup,
    updatePlayerAvatar,
    clearScores,
    clearEpisodeScores,
    clearHistory,
    resetAll,
    manualAssign,
    manualFinalize,
  } = useGameStateDB({ leagueId });
  
  const { user, isAdmin, playerName, loading, signOut } = useAuth();
  const { isLeagueAdmin, role: leagueRole, loading: roleLoading } = useLeagueRole(leagueId);
  const { getMyTeam, teams } = useLeagueTeams({ leagueId });
  const { isSuperAdmin } = useIsSuperAdmin();
  const navigate = useNavigate();
  
  // Get current user's team name for chat
  const myTeam = getMyTeam(user?.id);
  const userTeamName = myTeam?.name;

  // Track last_active_at on dashboard mount
  const hasTrackedActive = useRef(false);
  useEffect(() => {
    if (!loading && user && !hasTrackedActive.current) {
      updateLastActive(user.id);
      hasTrackedActive.current = true;
    }
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

  useEffect(() => {
    const fetchLeague = async () => {
      if (!leagueId) return;
      
      const { data, error } = await supabase
        .from('leagues')
        .select('name, allow_player_scoring')
        .eq('id', leagueId)
        .single();

      if (error) {
        toast.error('League not found');
        navigate('/leagues');
      } else {
        setLeagueName(data.name);
        setAllowPlayerScoring(!!data.allow_player_scoring);
      }
      setLeagueLoading(false);
    };

    fetchLeague();
  }, [leagueId, navigate]);


  // Determine draft/game state (must be before early returns for hooks)
  const computedPicksPerTeam = getPicksPerTeam(state.picksPerTeam, state.gameType, draftPoolSize(state.contestants), state.draftOrder.length);
  const totalPicks = state.draftOrder.length * computedPicksPerTeam;
  const isInDraftPhase = state.mode === "draft" || (state.mode === "setup" && draftPoolSize(state.contestants) >= (state.gameType === "winner_takes_all" ? 1 : computedPicksPerTeam * state.draftOrder.length));
  const canShowGame = totalPicks > 0 && state.currentDraftIndex >= totalPicks;

  // Set default viewMode based on game state
  useEffect(() => {
    if (canShowGame) {
      setViewMode((prev) => prev === "draft" ? "game" : prev);
    }
  }, [canShowGame]);

  // Season rollover: the platform admin sets "current season" in /admin > Settings.
  // If this league is behind it (or its season is marked complete), offer to move on.
  const platformSeason = parseInt(appSettings.current_season || "", 10) || 0;
  const nextSeason = platformSeason > state.season ? platformSeason : state.season + 1;
  const showSeasonBanner =
    !castCheckPending && (sessionStatus === "completed" || platformSeason > state.season);
  // Already drafting the new cast but still labeled with the old season number?
  // Then the fix is to relabel, not to archive.
  const seasonReason: "completed" | "new_available" | "relabel" =
    sessionStatus === "completed" ? "completed" : looksLikeNewCast ? "relabel" : "new_available";

  const handleRelabelSeason = async () => {
    await setSeason(platformSeason);
    toast.success(`Now labeled Season ${platformSeason}. Your cast, picks and scores didn't change.`);
  };

  // If this league is behind the current season but its castaways match the current
  // season's official cast, it's already playing the new season under an old label.
  const castNamesKey = state.contestants.map((c) => c.name).join("|");
  useEffect(() => {
    const current = parseInt(appSettings.current_season || "", 10) || 0;
    if (!current || current <= state.season || state.contestants.length === 0) {
      setLooksLikeNewCast(false);
      setCastCheckPending(false);
      return;
    }
    let cancelled = false;
    setCastCheckPending(true);
    supabase
      .from("master_contestants")
      .select("name")
      .eq("season_number", current)
      .then(({ data }) => {
        if (cancelled) return;
        const official = new Set((data || []).map((m) => m.name.trim().toLowerCase()));
        const matches = state.contestants.filter((c) =>
          official.has(c.name.trim().toLowerCase())
        ).length;
        setLooksLikeNewCast(
          official.size > 0 && matches >= Math.max(3, Math.ceil(state.contestants.length / 2))
        );
        setCastCheckPending(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings.current_season, state.season, castNamesKey]);

  const openNewSeasonDialog = () => {
    setRollover({
      from: state.season,
      to: nextSeason,
      hasDraft: state.contestants.some((c) => c.owner),
      castPreview: state.contestants
        .filter((c) => c.owner)
        .slice(0, 6)
        .map((c) => c.name)
        .join(", "),
    });
    setNewSeasonOpen(true);
  };

  const handleConfirmNewSeason = async () => {
    const { result, castImported } = await startNewSeason(rollover.to);
    if (result === "started") {
      toast.success(
        castImported > 0
          ? `Season ${rollover.to} is ready with all ${castImported} official castaways. Time to draft!`
          : `Season ${rollover.to} is ready. The official cast isn't posted yet, so add castaways in Admin or check back soon.`
      );
    }
    if (result !== "failed") setViewMode("draft");
    return result !== "failed";
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  if (loading || gameLoading || leagueLoading || roleLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" role="status">
        <p className="label-caps text-muted-foreground">Loading your league…</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const handleStartDraft = () => {
    const ppt = getPicksPerTeam(state.picksPerTeam, state.gameType, draftPoolSize(state.contestants), state.draftOrder.length);
    const minContestants = ppt * state.draftOrder.length;
    if (draftPoolSize(state.contestants) >= minContestants && !state.contestants.some((c) => c.owner)) {
      setMode("draft");
      trackEvent('draft_started', {
        league_name: leagueName,
        draft_time: Math.floor(Date.now() / 1000),
      });
    }
  };

  const handleStartGame = async () => {
    const ppt = getPicksPerTeam(state.picksPerTeam, state.gameType, draftPoolSize(state.contestants), state.draftOrder.length);
    const totalPicksCalc = state.draftOrder.length * ppt;
    if (state.currentDraftIndex >= totalPicksCalc) {
      // Ensure game starts in pre-merge state (unless the league starts after the merge: castaways
      // who went home before its first episode are already marked out)
      if (state.isPostMerge && !state.contestants.some((c) => c.isEliminated)) {
        await togglePostMerge();
      }
      setMode("game");
    }
  };

  const tabs = [
    !canShowGame && { key: "draft", label: "Draft", Icon: ClipboardList },
    { key: "game", label: "Game", Icon: Trophy },
    { key: "history", label: "History", Icon: History },
    { key: "league", label: "League", Icon: Users },
    isLeagueAdmin && { key: "admin", label: "Admin", Icon: Shield },
  ].filter(Boolean) as { key: ViewMode; label: string; Icon: typeof Trophy }[];

  return (
    <div className="min-h-screen">
      {/* Season Complete Banner */}
      {showSeasonBanner && (
        <SeasonCompleteBanner
          season={state.season}
          nextSeason={nextSeason}
          reason={seasonReason}
          isLeagueAdmin={isLeagueAdmin}
          onStartNewSeason={seasonReason === "relabel" ? handleRelabelSeason : openNewSeasonDialog}
        />
      )}
      <NewSeasonDialog
        open={newSeasonOpen}
        onOpenChange={setNewSeasonOpen}
        season={rollover.from}
        nextSeason={rollover.to}
        hasDraft={rollover.hasDraft}
        castPreview={rollover.castPreview}
        onConfirm={handleConfirmNewSeason}
      />

      {/* News Feed */}
      <NewsFeed />

      {/* League Header (canopy) */}
      <header className="bg-header">
        <div className="container max-w-7xl mx-auto px-4 pt-3 pb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              to="/leagues"
              className="flex min-h-[44px] items-center gap-2 text-sm font-semibold text-header-label transition-colors hover:text-[hsl(var(--header-fg))]"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="hidden sm:inline">My leagues</span>
              <Lockup className="ml-1 text-xl sm:text-2xl text-[hsl(var(--header-fg))]" />
            </Link>
            <div className="flex items-center gap-3">
              <span className="label-caps hidden md:block text-header-label">
                Season {state.season} · Episode {state.episode}
              </span>
              <button
                onClick={handleSignOut}
                className="flex min-h-[44px] items-center gap-2 rounded-[10px] px-2 text-sm font-semibold text-header-label transition-colors hover:text-[hsl(var(--header-fg))]"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="label-caps text-header-label">
              Season {state.season} · {state.gameType === "winner_takes_all" ? "Winner takes all" : "Full fantasy"}
            </span>
            <h1 className="font-display text-3xl sm:text-4xl leading-[0.95] break-words">{leagueName}</h1>
          </div>
        </div>
      </header>
      <div className="buff-trim" aria-hidden="true" />

      {/* Mode Navigation: pills under the header on tablet/desktop, a bottom tab bar on phones.
          Only one of the two renders, so the onboarding tour's data-tour targets stay unique. */}
      {!isMobile ? (
        <nav className="sticky top-0 z-50 border-b-2 border-plank bg-card/95 backdrop-blur-sm" aria-label="League sections">
          <div className="container max-w-7xl mx-auto px-2 sm:px-4 py-2">
            <div className="flex gap-1 overflow-x-auto flex-nowrap">
              {tabs.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  data-tour={key}
                  onClick={() => setViewMode(key)}
                  aria-current={viewMode === key ? "page" : undefined}
                  className={`flex min-h-[44px] flex-1 sm:flex-none shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm transition-colors ${
                    viewMode === key
                      ? "bg-primary text-primary-foreground font-extrabold"
                      : "font-semibold text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="hidden sm:block h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </nav>
      ) : (
        <nav
          className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-plank bg-card/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
          aria-label="League sections"
        >
          <div className="flex items-stretch gap-1 px-2 py-1.5">
            {tabs.map(({ key, label, Icon }) => (
              <button
                key={key}
                data-tour={key}
                onClick={() => {
                  setViewMode(key);
                  window.scrollTo({ top: 0 });
                }}
                aria-current={viewMode === key ? "page" : undefined}
                className={`flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] transition-colors ${
                  viewMode === key
                    ? "bg-primary text-primary-foreground font-extrabold"
                    : "font-semibold text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* Commissioner Checklist - show on Draft tab during setup/draft */}
      {isLeagueAdmin && viewMode === "draft" && (state.mode === "setup" || state.mode === "draft") && (
        <CommissionerChecklist
          leagueId={leagueId!}
          contestantCount={state.contestants.length}
          filledTeamCount={teams.filter(t => t.user_id).length}
          mode={state.mode}
          onNavigate={setViewMode}
        />
      )}

      {/* Draft Tab */}
      {viewMode === "draft" && !canShowGame && (
        <>
          {/* Starting mid-season: take castaways who already went home out of the draft */}
          {leagueRole === "league_admin" && state.gameType !== "winner_takes_all" && (
            <LateStartCard
              season={state.season}
              sessionId={sessionId || undefined}
              contestants={state.contestants}
              scoringEvents={state.scoringEvents}
              scoringConfig={scoringConfig}
              onApply={applyEpisodeResults}
              onUndo={undoEpisodeResults}
              explicitPicks={state.picksPerTeam}
              teamCount={state.draftOrder.length}
            />
          )}
          {isLeagueAdmin && state.contestants.some(c => c.owner) && (
            <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
              <div className="flex flex-wrap items-center gap-3 rounded-[12px] border-2 border-accent bg-accent/10 px-4 py-3">
                <Undo2 className="h-4 w-4 text-accent shrink-0" />
                <span className="text-sm font-semibold flex-1 min-w-[180px]">Draft in progress. Need to start over?</span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const first = confirm("REVERT TO SETUP?\n\nThis will clear ALL draft picks and let you re-draft. Are you sure?");
                    if (!first) return;
                    const second = confirm("FINAL CONFIRMATION\n\nAll contestant assignments will be removed. This cannot be undone.\n\nClick OK to revert.");
                    if (second) revertToSetup();
                  }}
                >
                  <Undo2 className="h-4 w-4 mr-1" />
                  Revert to setup
                </Button>
              </div>
            </div>
          )}
          <DraftMode
            leagueId={leagueId}
            contestants={state.contestants}
            draftOrder={state.draftOrder}
            draftType={state.draftType}
            currentDraftIndex={state.currentDraftIndex}
            gameType={state.gameType}
            picksPerTeam={state.picksPerTeam}
            onDraftContestant={draftContestant}
            onUndoPick={undoDraftPick}
            onStartGame={handleStartGame}
            onManualAssign={manualAssign}
            onManualFinalize={manualFinalize}
            season={state.season}
            onImportOfficialCast={importOfficialCast}
          />
        </>
      )}

      {/* Game Tab */}
      {viewMode === "game" && (
        <>
          <GameplayTips leagueId={leagueId!} />
          {/* Auto-scoring card: commissioners of this league only (not the site owner browsing other leagues) */}
          {leagueRole === "league_admin" && canShowGame && state.gameType !== "winner_takes_all" && (
            <EpisodeResultsCard
              season={state.season}
              sessionId={sessionId || undefined}
              contestants={state.contestants}
              scoringEvents={state.scoringEvents}
              scoringConfig={scoringConfig}
              onApply={applyEpisodeResults}
              onUndo={undoEpisodeResults}
            />
          )}
          {!canShowGame && !isSuperAdmin && (
            <div className="container max-w-7xl mx-auto px-4 md:px-8 mt-4">
              <div className="glass rounded-[12px] flex items-center gap-3 px-4 py-3 text-sm">
                <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span>Scoring opens once the draft is done. Look around to see how it works.</span>
              </div>
            </div>
          )}
          <div className={!canShowGame && !isSuperAdmin ? "opacity-50 pointer-events-none" : ""}>
          {state.gameType === "winner_takes_all" ? (
            <WinnerTakesAllMode
              leagueId={leagueId}
              contestants={state.contestants}
              draftOrder={state.draftOrder}
              isAdmin={isLeagueAdmin}
              sessionId={sessionId || undefined}
              sessionStatus={sessionStatus}
              scoringEvents={state.scoringEvents}
            />
          ) : (
            <GameMode
              leagueId={leagueId}
              currentUserId={user?.id}
              season={state.season}
              episode={state.episode}
              isPostMerge={state.isPostMerge}
              contestants={state.contestants}
              scoringEvents={state.scoringEvents}
              cryingThisEpisode={state.cryingThisEpisode}
              playerProfiles={state.playerProfiles}
              scoringConfig={scoringConfig}
              draftOrder={state.draftOrder}
              isAdmin={isLeagueAdmin}
              allowPlayerScoring={allowPlayerScoring}
              playerName={userTeamName || playerName}
              sessionId={sessionId || undefined}
              onEpisodeChange={setEpisode}
              onTogglePostMerge={togglePostMerge}
              onAddScoringEvent={addScoringEvent}
              onUndo={undoLastEvent}
              onUndoEvent={undoEvent}
              onExport={exportData}
              onUpdatePlayerAvatar={updatePlayerAvatar}
            />
          )}
          </div>
        </>
      )}

      {/* History Tab */}
      {viewMode === "history" && leagueId && (
        <HistoryMode
          leagueId={leagueId}
          archivedSeasons={state.archivedSeasons}
          playerProfiles={state.playerProfiles}
        />
      )}

      {/* League Tab */}
      {viewMode === "league" && leagueId && (
        <LeagueInfo leagueId={leagueId} />
      )}

      {/* Admin Tab */}
      {viewMode === "admin" && isLeagueAdmin && leagueId && (
        <div className="container max-w-7xl mx-auto p-4">
          <AdminPanel 
            leagueId={leagueId}
            currentEpisode={state.episode}
            gameType={state.gameType}
            season={state.season}
            contestants={state.contestants}
            draftOrder={state.draftOrder}
            draftType={state.draftType}
            onSeasonChange={setSeason}
            onAddContestant={addContestant}
            onUpdateContestant={updateContestant}
            onDeleteContestant={deleteContestant}
            onRandomizeDraftOrder={randomizeDraftOrder}
            onSetDraftOrder={setDraftOrder}
            onDraftTypeChange={setDraftType}
            onStartDraft={handleStartDraft}
            onImport={importData}
            onExport={exportData}
            onSetContestants={setContestants}
            picksPerTeam={state.picksPerTeam}
            onSetPicksPerTeam={setPicksPerTeam}
            onClearScores={clearScores}
            onClearEpisodeScores={clearEpisodeScores}
            onClearHistory={clearHistory}
            onResetAll={resetAll}
            onRevertToSetup={revertToSetup}
            onScoringConfigSaved={setScoringConfig}
            onNewSeason={openNewSeasonDialog}
          />
        </div>
      )}

      {/* Floating Chat Widget */}
      <LeagueChat
        leagueId={leagueId}
        userId={user?.id}
        userEmail={user?.email}
        userTeamName={userTeamName}
        teams={teams}
      />

      {/* Onboarding Tour */}
      {leagueId && (
        <OnboardingTour leagueId={leagueId} isLeagueAdmin={isLeagueAdmin} isSuperAdmin={isSuperAdmin} />
      )}
    </div>
  );
};

export default LeagueDashboard;
