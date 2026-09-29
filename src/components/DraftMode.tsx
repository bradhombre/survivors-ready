import { Fragment, useMemo, useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Player, Contestant, DraftType, GameType } from "@/types/survivor";
import { draftPoolSize, getPicksPerTeam } from "@/lib/picksPerTeam";
import { ArrowRight, Undo2, Settings2 } from "lucide-react";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { useLeagueRole } from "@/hooks/useLeagueRole";
import { TeamAvatar } from "./TeamAvatar";
import { ContestantAvatar } from "./ContestantAvatar";
import { ManualAssignment } from "./ManualAssignment";
import { updateLastActive } from "@/lib/customerio";
import { useAuth } from "@/hooks/useAuth";

interface DraftModeProps {
  leagueId?: string;
  contestants: Contestant[];
  draftOrder: Player[];
  draftType: DraftType;
  currentDraftIndex: number;
  gameType?: GameType;
  picksPerTeam?: number | null;
  onDraftContestant: (contestantId: string) => void;
  onUndoPick: () => void;
  onStartGame: () => void;
  onManualAssign?: (contestantId: string, teamName: string) => Promise<void>;
  onManualFinalize?: () => Promise<void>;
  season?: number;
  onImportOfficialCast?: () => Promise<number>;
}

export const DraftMode = ({
  leagueId,
  contestants,
  draftOrder,
  draftType,
  currentDraftIndex,
  gameType = "full",
  picksPerTeam: explicitPicks,
  onDraftContestant,
  onUndoPick,
  onStartGame,
  onManualAssign,
  onManualFinalize,
  season,
  onImportOfficialCast,
}: DraftModeProps) => {
  // Get league teams for avatars
  const { teams } = useLeagueTeams({ leagueId });
  const { user } = useAuth();
  const { isLeagueAdmin } = useLeagueRole(leagueId);
  const [manualMode, setManualMode] = useState(false);
  const [importingCast, setImportingCast] = useState(false);

  // Map team names to their avatar URLs
  const teamAvatarMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    teams.forEach(team => {
      map[team.name] = team.avatar_url || null;
    });
    return map;
  }, [teams]);
  const teamCount = draftOrder.length;
  const picksPerTeam = getPicksPerTeam(explicitPicks, gameType, draftPoolSize(contestants), teamCount);
  const totalPicks = teamCount * picksPerTeam;
  // Castaways who went home before this league's first episode aren't in the draft
  const availableContestants = contestants.filter((c) => !c.owner && !c.isEliminated);
  const goneBeforeDraft = contestants.filter((c) => !c.owner && c.isEliminated).length;
  const draftedContestants = contestants.filter((c) => c.owner);

  const getCurrentDrafter = () => {
    if (currentDraftIndex >= totalPicks || teamCount === 0) return null;
    
    if (draftType === "snake") {
      const round = Math.floor(currentDraftIndex / teamCount);
      const posInRound = currentDraftIndex % teamCount;
      return round % 2 === 0 ? draftOrder[posInRound] : draftOrder[teamCount - 1 - posInRound];
    } else {
      return draftOrder[currentDraftIndex % teamCount];
    }
  };

  const currentDrafter = getCurrentDrafter();

  // Same order rule as getCurrentDrafter, for any pick index (used for "up next")
  const getDrafterAt = (index: number) => {
    if (index >= totalPicks || teamCount === 0) return null;
    if (draftType === "snake") {
      const round = Math.floor(index / teamCount);
      const posInRound = index % teamCount;
      return round % 2 === 0 ? draftOrder[posInRound] : draftOrder[teamCount - 1 - posInRound];
    }
    return draftOrder[index % teamCount];
  };
  const nextDrafter = getDrafterAt(currentDraftIndex + 1);
  const round = teamCount > 0 ? Math.floor(currentDraftIndex / teamCount) + 1 : 1;
  const myTeamName = teams.find((t) => t.user_id && t.user_id === user?.id)?.name;
  const isMyPick = !!currentDrafter && currentDrafter === myTeamName;

  // Tribe filter chips for the available list
  const [tribeFilter, setTribeFilter] = useState<string | null>(null);
  const tribes = useMemo(
    () => Array.from(new Set(contestants.map((c) => c.tribe).filter((t): t is string => !!t))).sort(),
    [contestants]
  );

  const [isDrafting, setIsDrafting] = useState(false);

  const handleDraftContestant = useCallback(async (contestantId: string) => {
    if (isDrafting) return;
    // Enforce per-team pick limit before allowing the pick
    if (currentDrafter) {
      const owned = draftedContestants.filter(c => c.owner === currentDrafter).length;
      if (owned >= picksPerTeam) {
        return; // team is full, skip
      }
    }
    setIsDrafting(true);
    try {
      if (user) updateLastActive(user.id);
      await onDraftContestant(contestantId);
    } finally {
      // Small delay to let realtime update propagate before re-enabling
      setTimeout(() => setIsDrafting(false), 500);
    }
  }, [isDrafting, user, onDraftContestant, currentDrafter, draftedContestants, picksPerTeam]);
  
  const progress = totalPicks > 0 ? (currentDraftIndex / totalPicks) * 100 : 0;
  const isDraftComplete = currentDraftIndex >= totalPicks;

  const getPlayerContestants = (player: Player) => {
    return draftedContestants
      .filter((c) => c.owner === player)
      .sort((a, b) => (a.pickNumber || 0) - (b.pickNumber || 0));
  };

  // If the chosen tribe disappears (tribes edited mid-draft), fall back to everyone
  const activeTribe = tribeFilter && tribes.includes(tribeFilter) ? tribeFilter : null;
  const visibleContestants = activeTribe
    ? availableContestants.filter((c) => c.tribe === activeTribe)
    : availableContestants;

  const castawayDetails = (c: Contestant) =>
    [c.age ? String(c.age) : null, c.location, c.tribe].filter(Boolean).join(" · ");

  const upNextNote = (() => {
    if (!currentDrafter || !nextDrafter) return null;
    if (nextDrafter === currentDrafter) return `${currentDrafter} picks again right after this (snake).`;
    return `${nextDrafter} is up next.`;
  })();

  // The next few picks in order, so everyone can see who's coming up
  const upcoming = Array.from({ length: Math.max(0, Math.min(8, totalPicks - currentDraftIndex)) }, (_, i) => {
    const index = currentDraftIndex + i;
    return { index, team: getDrafterAt(index), round: teamCount > 0 ? Math.floor(index / teamCount) + 1 : 1 };
  });

  // When is my next turn? (only if it isn't right now)
  const myNextPick = (() => {
    if (!myTeamName || isMyPick) return null;
    for (let i = currentDraftIndex + 1; i < totalPicks; i++) {
      if (getDrafterAt(i) === myTeamName) return { number: i + 1, away: i - currentDraftIndex };
    }
    return null;
  })();

  return (
    <div className="container max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* On the clock (hidden until there's a cast to pick from) */}
      {!isDraftComplete && currentDrafter && contestants.length > 0 && (
        <section className="plank overflow-hidden" aria-live="polite">
          <div className="bg-accent text-accent-foreground px-5 py-5 sm:px-6">
            <p className="label-caps opacity-90 tabular">
              {gameType === "winner_takes_all" ? "Sole Survivor picks" : `Round ${round}`} · Pick {currentDraftIndex + 1} of {totalPicks}
            </p>
            <h1 className="font-display text-4xl sm:text-5xl leading-[0.95] mt-2 break-words">
              {isMyPick ? `Your pick, ${currentDrafter}` : `${currentDrafter} is on the clock`}
            </h1>
            {upNextNote && <p className="mt-2 text-sm font-semibold opacity-90">{upNextNote}</p>}
            {myNextPick && (
              <p className="mt-1 text-sm font-semibold opacity-90 tabular">
                Your next pick is #{myNextPick.number}, {myNextPick.away === 1 ? "right after this one" : `${myNextPick.away} picks away`}.
              </p>
            )}
          </div>
          {upcoming.length > 1 && (
            <div className="border-b-2 border-border px-5 py-3 sm:px-6">
              <p className="label-caps text-muted-foreground">Draft order: coming up</p>
              <ol className="mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Upcoming picks">
                {upcoming.map((p, i) => {
                  const isNow = i === 0;
                  const isMine = !!myTeamName && p.team === myTeamName;
                  const newRound = i > 0 && p.round !== upcoming[i - 1].round && gameType !== "winner_takes_all";
                  return (
                    <Fragment key={p.index}>
                      {newRound && (
                        <li aria-hidden="true" className="label-caps shrink-0 self-center px-1 text-muted-foreground">
                          Rd {p.round}
                        </li>
                      )}
                      <li
                        className={`min-w-[96px] shrink-0 rounded-[10px] px-3 py-2 ${
                          isNow
                            ? "border-2 border-plank bg-accent text-accent-foreground"
                            : isMine
                            ? "border-2 border-accent bg-card"
                            : "glass"
                        }`}
                      >
                        <span className="block text-[11px] font-bold tabular opacity-80">
                          {isNow ? "On the clock" : `Pick ${p.index + 1}`}
                        </span>
                        <span className="block max-w-[150px] truncate text-sm font-extrabold">
                          {p.team}
                          {isMine ? " (you)" : ""}
                        </span>
                      </li>
                    </Fragment>
                  );
                })}
              </ol>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 px-5 py-3 sm:px-6">
            <div className="flex-1 min-w-[160px]">
              <Progress value={progress} className="h-2.5" aria-label="Draft progress" />
              <p className="mt-1 text-xs font-semibold text-muted-foreground tabular">
                {currentDraftIndex} of {totalPicks} picks made
              </p>
            </div>
            {currentDraftIndex > 0 && (
              <Button onClick={onUndoPick} variant="outline" size="sm" className="h-11 gap-2">
                <Undo2 className="h-4 w-4" />
                Undo last pick
              </Button>
            )}
            {isLeagueAdmin && onManualAssign && onManualFinalize && (
              <Button onClick={() => setManualMode((v) => !v)} variant="ghost" size="sm" className="h-11 gap-2">
                <Settings2 className="h-4 w-4" />
                {manualMode ? "Back to the draft" : "Assign teams by hand"}
              </Button>
            )}
          </div>
        </section>
      )}

      {/* Draft complete */}
      {isDraftComplete && (
        <section className="plank px-5 py-6 sm:px-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex-1">
            <p className="label-caps text-success">All {totalPicks} picks are in</p>
            <h1 className="font-display text-4xl leading-none mt-1 text-primary">Draft complete</h1>
          </div>
          <Button onClick={onStartGame} size="lg" variant="accent" className="gap-2">
            Start the game
            <ArrowRight className="h-5 w-5" />
          </Button>
        </section>
      )}

      {/* Manual Assignment Mode */}
      {manualMode && onManualAssign && onManualFinalize ? (
        <ManualAssignment
          contestants={contestants.filter((c) => !!c.owner || !c.isEliminated)}
          draftOrder={draftOrder}
          picksPerTeam={picksPerTeam}
          onAssign={onManualAssign}
          onFinalize={onManualFinalize}
        />
      ) : (
      <>
      {/* Available castaways (first on phones, where the picking happens) */}
      {!isDraftComplete && (
        <section className="plank p-4 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-display text-3xl leading-none">Available castaways</h2>
            <span className="label-caps text-muted-foreground tabular">{availableContestants.length} left</span>
          </div>
          {goneBeforeDraft > 0 && (
            <p className="text-sm text-muted-foreground tabular">
              {goneBeforeDraft} castaway{goneBeforeDraft === 1 ? "" : "s"} who went home before your league's first episode{" "}
              {goneBeforeDraft === 1 ? "isn't" : "aren't"} in the draft.
            </p>
          )}

          {availableContestants.length === 0 && contestants.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <p className="font-display text-2xl leading-none">No castaways yet</p>
              {isLeagueAdmin && onImportOfficialCast ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Bring in the official Season {season} cast with photos and tribes, or add castaways yourself in the <strong>Admin</strong> tab.
                  </p>
                  <Button
                    className="mt-2"
                    variant="accent"
                    disabled={importingCast}
                    onClick={async () => {
                      setImportingCast(true);
                      try {
                        await onImportOfficialCast();
                      } finally {
                        setImportingCast(false);
                      }
                    }}
                  >
                    {importingCast ? "Importing..." : `Import Season ${season} cast`}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Your commissioner needs to add the cast before drafting can begin.</p>
              )}
            </div>
          ) : (
          <>
            {tribes.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter by tribe">
                {[null, ...tribes].map((tribe) => {
                  const active = activeTribe === tribe;
                  return (
                    <button
                      key={tribe ?? "all"}
                      type="button"
                      onClick={() => setTribeFilter(tribe)}
                      aria-pressed={active}
                      className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-bold transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground border-2 border-plank"
                          : "glass text-foreground hover:bg-muted"
                      }`}
                    >
                      {tribe ?? "All tribes"}
                    </button>
                  );
                })}
              </div>
            )}
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {visibleContestants.map((contestant) => (
                <li
                  key={contestant.id}
                  className="glass rounded-[12px] flex items-center gap-3 p-2.5 min-h-[60px]"
                >
                  <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="md" />
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold leading-tight truncate">{contestant.name}</p>
                    {castawayDetails(contestant) && (
                      <p className="text-xs text-muted-foreground truncate">{castawayDetails(contestant)}</p>
                    )}
                  </div>
                  <Button
                    onClick={() => handleDraftContestant(contestant.id)}
                    disabled={isDrafting}
                    variant={isMyPick ? "accent" : "outline"}
                    size="sm"
                    className="h-11 px-4 shrink-0"
                    aria-label={`Draft ${contestant.name}`}
                  >
                    Draft
                  </Button>
                </li>
              ))}
              {visibleContestants.length === 0 && (
                <li className="text-sm text-muted-foreground py-4">
                  {activeTribe ? `Everyone from ${activeTribe} has been drafted.` : "Everyone's been drafted."}
                </li>
              )}
            </ul>
          </>
          )}
        </section>
      )}

      {/* Teams */}
      <section className="space-y-3">
        <h2 className="font-display text-3xl leading-none">{gameType === "winner_takes_all" ? "Picks so far" : "Tribes so far"}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {draftOrder.map((player, index) => {
            const playerTeam = getPlayerContestants(player);
            const isCurrentDrafter = player === currentDrafter;

            return (
              <Card
                key={`${String(player)}-${index}`}
                className={`p-4 space-y-3 ${isCurrentDrafter ? "border-accent" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <TeamAvatar
                    teamName={String(player)}
                    avatarUrl={teamAvatarMap[player]}
                    size="md"
                    className="shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-2xl leading-[0.95] break-words">{player}</h3>
                    {isCurrentDrafter ? (
                      <span className="mt-1 inline-block rounded-full bg-accent px-2.5 py-0.5 text-xs font-bold text-accent-foreground">
                        On the clock
                      </span>
                    ) : (
                      <span className="label-caps mt-1 block text-muted-foreground tabular">Draft slot {index + 1}</span>
                    )}
                  </div>
                  <span className="glass rounded-full px-2.5 py-1 text-sm font-extrabold tabular shrink-0">
                    {playerTeam.length}/{picksPerTeam}
                  </span>
                </div>

                {playerTeam.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {playerTeam.map((contestant) => (
                      <li key={contestant.id} className="flex items-center gap-2 py-2">
                        <ContestantAvatar name={contestant.name} imageUrl={contestant.imageUrl} size="sm" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{contestant.name}</p>
                          {castawayDetails(contestant) && (
                            <p className="text-xs text-muted-foreground truncate">{castawayDetails(contestant)}</p>
                          )}
                        </div>
                        <span className="text-xs font-bold text-muted-foreground tabular shrink-0">#{contestant.pickNumber}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No picks yet.</p>
                )}
              </Card>
            );
          })}
        </div>
      </section>
      </>
      )}
    </div>
  );
};
