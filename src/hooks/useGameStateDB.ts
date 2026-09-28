import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GameState, Player, Contestant, ScoringEvent, DraftType, GameType } from "@/types/survivor";
import { toast } from "sonner";
import { trackEvent } from "@/lib/customerio";
import { importOfficialCast } from "@/lib/officialCast";
import { ScoringConfig } from "@/lib/scoring";

const LOCAL_MODE_KEY = "survivor-local-mode";

interface UseGameStateDBOptions {
  leagueId?: string;
}

interface LeagueTeam {
  id: string;
  name: string;
  position: number;
  user_id: string | null;
}

export const useGameStateDB = (options: UseGameStateDBOptions = {}) => {
  const { leagueId } = options;

  const [leagueTeams, setLeagueTeams] = useState<LeagueTeam[]>([]);
  const [state, setState] = useState<GameState>({
    mode: (localStorage.getItem(LOCAL_MODE_KEY) as GameState["mode"]) || "setup",
    season: 49,
    episode: 1,
    isPostMerge: false,
    contestants: [],
    draftOrder: [],
    draftType: "snake",
    currentDraftIndex: 0,
    scoringEvents: [],
    cryingThisEpisode: new Set(),
    playerProfiles: {},
    archivedSeasons: [],
    gameType: "full",
    picksPerTeam: null,
  });
  const [sessionId, setSessionIdState] = useState<string | null>(null);
  // The session the screen is currently showing. Loads for any other session are ignored,
  // so a slow reload of last season can't overwrite the new one.
  const currentSidRef = useRef<string | null>(null);
  const setSessionId = (sid: string | null) => {
    currentSidRef.current = sid;
    setSessionIdState(sid);
  };
  const [sessionStatus, setSessionStatus] = useState<string>("active");
  const [loading, setLoading] = useState(true);
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);

  // Fetch league teams
  const fetchLeagueTeams = useCallback(async () => {
    if (!leagueId) return [];

    const { data, error } = await supabase
      .from("league_teams")
      .select("*")
      .eq("league_id", leagueId)
      .order("position", { ascending: true });

    if (error) {
      console.error("Error fetching league teams:", error);
      return [];
    }

    return data || [];
  }, [leagueId]);

  // Initialize or load session for the specific league
  useEffect(() => {
    if (!leagueId) {
      setLoading(false);
      return;
    }

    const initSession = async () => {
      try {
        // Get league teams first
        const teams = await fetchLeagueTeams();
        setLeagueTeams(teams);

        // Get the game session for this specific league
        const { data: leagueSession, error: queryError } = await supabase
          .from("game_sessions")
          .select("*")
          .eq("league_id", leagueId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (queryError) {
          console.error("Error querying league session:", queryError);
          toast.error("Failed to load game session. Please refresh the page.");
          setLoading(false);
          return;
        }

        if (leagueSession) {
          console.log("Loading league session:", leagueSession.id);
          let status: string = (leagueSession as any).status || "active";

          // The old "Start New Season" button saved the season, emptied the session,
          // bumped the season number and marked it "completed". Some commissioners then
          // imported the new cast and drafted inside that "completed" session.
          // The only real way to finish a season is crowning a winner, so a completed
          // session with no "Win Survivor" event is a live season: reopen it as-is.
          // This only changes the status flag; cast, picks and scores are untouched.
          if (status === "completed") {
            const { count: crownCount, error: crownError } = await supabase
              .from("scoring_events")
              .select("id", { count: "exact", head: true })
              .eq("session_id", leagueSession.id)
              .ilike("action", "%Win Survivor%");
            if (!crownError && crownCount === 0) {
              status = "active";
              await supabase
                .from("game_sessions")
                .update({ status: "active" } as any)
                .eq("id", leagueSession.id);
            }
          }

          setSessionId(leagueSession.id);
          setSessionStatus(status);
          await loadGameState(leagueSession.id, teams);
          
          // Fetch league's scoring config
          const { data: leagueData } = await supabase
            .from("leagues")
            .select("scoring_config")
            .eq("id", leagueId)
            .maybeSingle();
          
          if (leagueData?.scoring_config) {
            setScoringConfig(leagueData.scoring_config as ScoringConfig);
          }
          
          setLoading(false);
          return;
        }

        // No session exists for this league - this shouldn't happen since create_league creates one
        console.error("No game session found for league:", leagueId);
        toast.error("No game session found for this league.");
        setLoading(false);
      } catch (error) {
        console.error("Error initializing session:", error);
        toast.error("Failed to initialize game session");
        setLoading(false);
      }
    };

    initSession();
  }, [leagueId, fetchLeagueTeams]);

  // Load game state from database
  const loadGameState = async (sid: string, teams?: LeagueTeam[]) => {
    try {
      const teamsToUse = teams || leagueTeams;
      
      const [sessionData, contestantsData, scoringData, draftData, cryingData, profilesData, archivedData] = await Promise.all([
        supabase.from("game_sessions").select("*").eq("id", sid).single(),
        supabase.from("contestants").select("*").eq("session_id", sid),
        supabase.from("scoring_events").select("*").eq("session_id", sid).order("created_at", { ascending: true }),
        supabase.from("draft_order").select("*").eq("session_id", sid).order("position", { ascending: true }),
        supabase.from("crying_contestants").select("*").eq("session_id", sid),
        supabase.from("player_profiles").select("*").eq("session_id", sid),
        leagueId 
          ? supabase.from("archived_seasons").select("*").eq("league_id", leagueId).order("created_at", { ascending: false })
          : supabase.from("archived_seasons").select("*").order("created_at", { ascending: false }),
      ]);

      // Drop results for a session we've already switched away from
      if (currentSidRef.current && sid !== currentSidRef.current) return;

      const session = sessionData.data;
      const contestants = contestantsData.data || [];
      console.log('Loaded contestants from DB:', contestants.length, contestants.map(c => ({ name: c.name, owner: c.owner, pick: c.pick_number })));
      const scoringEvents = scoringData.data || [];
      
      // Reconcile draft_order with league teams (self-healing)
      const teamNames = teamsToUse.map(t => t.name);
      const teamSet = new Set(teamNames);
      let draftOrder: string[];
      
      if (draftData.data && draftData.data.length > 0) {
        const dbOrder = [...new Set(draftData.data.map((d) => d.player_name))];
        // Keep only teams that still exist, preserving their order
        const validOrder = dbOrder.filter(name => teamSet.has(name));
        // Add any new teams that aren't in the draft order
        teamNames.forEach(name => {
          if (!validOrder.includes(name)) {
            validOrder.push(name);
          }
        });
        draftOrder = validOrder;
      } else {
        // Initialize from league teams
        draftOrder = teamNames;
      }
      
      // Only include crying contestants for the CURRENT episode
      const currentEpisode = session?.episode || 1;
      const crying = new Set(
        (cryingData.data || [])
          .filter((c) => c.episode === currentEpisode)
          .map((c) => c.contestant_id)
      );
      
      // Build player profiles from both DB and league teams
      const profiles = (profilesData.data || []).reduce((acc, p) => {
        acc[p.player_name] = { avatar: p.avatar };
        return acc;
      }, {} as Record<Player, { avatar?: string }>);
      
      // Ensure all teams have a profile entry
      teamsToUse.forEach(team => {
        if (!profiles[team.name]) {
          profiles[team.name] = {};
        }
      });
      
      const archived = (archivedData.data || []).map((a) => ({
        season: a.season,
        contestants: (a.contestants as any) as Contestant[],
        scoringEvents: (a.scoring_events as any) as ScoringEvent[],
        finalStandings: (a.final_standings as any) as any[],
        archivedAt: a.archived_at,
      }));

      // Keep status in sync (e.g. a Winner Takes All crown from another device)
      if ((session as any)?.status) setSessionStatus((session as any).status);

      // Use DB mode as the source of truth, fallback to local
      const dbMode = session.mode as GameState["mode"];
      localStorage.setItem(LOCAL_MODE_KEY, dbMode);
      console.log(`Loading game state - DB mode: ${dbMode}, draft index: ${session.current_draft_index}`);

      setState({
        mode: dbMode,
        season: session.season,
        episode: session.episode,
        isPostMerge: session.is_post_merge,
        gameType: ((session as any).game_type as GameType) || "full",
        picksPerTeam: (session as any).picks_per_team ?? null,
      contestants: contestants.map((c) => ({
          id: c.id,
          name: c.name,
          tribe: c.tribe,
          age: c.age,
          location: c.location,
          owner: c.owner as Player | undefined,
          pickNumber: c.pick_number,
          isEliminated: c.is_eliminated,
          imageUrl: (c as any).image_url || undefined,
        })),
        draftOrder: draftOrder as Player[],
        draftType: session.draft_type as DraftType,
        currentDraftIndex: session.current_draft_index,
        scoringEvents: scoringEvents.map((e) => ({
          id: e.id,
          contestantId: e.contestant_id,
          contestantName: e.contestant_name,
          action: e.action,
          points: e.points,
          episode: e.episode,
          timestamp: new Date(e.created_at).getTime(),
        })),
        cryingThisEpisode: crying,
        playerProfiles: profiles,
        archivedSeasons: archived,
      });
    } catch (error) {
      console.error("Error loading game state:", error);
    }
  };

  // Debounced reload to prevent concurrent loadGameState calls from racing
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, [sessionId]);

  const debouncedReload = useCallback(() => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      if (sessionId) loadGameState(sessionId);
    }, 300);
  }, [sessionId]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // Ids of this session's scoring events, so we can recognize their DELETE events.
  // (Supabase realtime can't apply a session_id filter to deletes; they only carry the row id.)
  const scoringEventIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    scoringEventIdsRef.current = new Set(state.scoringEvents.map((e) => e.id));
  }, [state.scoringEvents]);

  // Set up realtime subscriptions
  useEffect(() => {
    if (!sessionId) return;

    const channel = supabase
      .channel(`game-state-${sessionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "contestants", filter: `session_id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scoring_events", filter: `session_id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "draft_order", filter: `session_id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "crying_contestants", filter: `session_id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_profiles", filter: `session_id=eq.${sessionId}` },
        debouncedReload
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "scoring_events" },
        (payload) => {
          const id = (payload.old as { id?: string } | null)?.id;
          if (id && scoringEventIdsRef.current.has(id)) debouncedReload();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, debouncedReload]);

  // When a commissioner starts a new season on another device, follow them to it
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`league-sessions-${leagueId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "game_sessions", filter: `league_id=eq.${leagueId}` },
        async (payload) => {
          const newId = (payload.new as { id?: string } | null)?.id;
          if (newId && newId !== currentSidRef.current) {
            setSessionId(newId);
            setSessionStatus("active");
            await loadGameState(newId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Keep league team slots in sync in realtime
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`league-teams-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_teams",
          filter: `league_id=eq.${leagueId}`,
        },
        async () => {
          const teams = await fetchLeagueTeams();
          setLeagueTeams(teams);
          if (sessionId) {
            await loadGameState(sessionId, teams);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, fetchLeagueTeams, sessionId]);

  const setMode = async (mode: GameState["mode"]) => {
    console.log(`Setting mode to: ${mode}`);
    localStorage.setItem(LOCAL_MODE_KEY, mode);
    setState((prev) => ({ ...prev, mode }));
    if (sessionId) {
      await supabase.from("game_sessions").update({ mode }).eq("id", sessionId);
    }
  };

  const setSeason = async (season: number) => {
    if (!sessionId) return;
    setState((prev) => ({ ...prev, season }));
    await supabase.from("game_sessions").update({ season }).eq("id", sessionId);
  };

  const setEpisode = async (episode: number) => {
    if (!sessionId) return;
    await supabase.from("game_sessions").update({ episode }).eq("id", sessionId);
    await supabase.from("crying_contestants").delete().eq("session_id", sessionId).eq("episode", episode);
  };

  const togglePostMerge = async () => {
    if (!sessionId) return;
    await supabase.from("game_sessions").update({ is_post_merge: !state.isPostMerge }).eq("id", sessionId);
  };

  const addContestant = async (name: string, tribe?: string, age?: number, location?: string) => {
    if (!sessionId) return;
    await supabase.from("contestants").insert({
      session_id: sessionId,
      name,
      tribe,
      age,
      location,
      is_eliminated: false,
    });
  };

  const updateContestant = async (id: string, updates: Partial<Contestant>) => {
    if (!sessionId) return;
    const dbUpdates: any = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.tribe !== undefined) dbUpdates.tribe = updates.tribe;
    if (updates.age !== undefined) dbUpdates.age = updates.age;
    if (updates.location !== undefined) dbUpdates.location = updates.location;
    if (updates.isEliminated !== undefined) dbUpdates.is_eliminated = updates.isEliminated;
    if (updates.owner !== undefined) dbUpdates.owner = updates.owner;
    if (updates.pickNumber !== undefined) dbUpdates.pick_number = updates.pickNumber;
    
    await supabase.from("contestants").update(dbUpdates).eq("id", id);
  };

  const deleteContestant = async (id: string) => {
    if (!sessionId) return;
    await supabase.from("contestants").delete().eq("id", id);
  };

  const setContestants = async (contestants: Contestant[]) => {
    if (!sessionId) return;
    
    // Delete all existing contestants
    await supabase.from("contestants").delete().eq("session_id", sessionId);
    
    // Insert new contestants
    if (contestants.length > 0) {
      await supabase.from("contestants").insert(
        contestants.map((c) => ({
          id: c.id,
          session_id: sessionId,
          name: c.name,
          tribe: c.tribe,
          age: c.age,
          location: c.location,
          owner: c.owner,
          pick_number: c.pickNumber,
          is_eliminated: c.isEliminated,
        }))
      );
    }
  };

  const randomizeDraftOrder = async () => {
    if (!sessionId) return;
    const shuffled = [...state.draftOrder].sort(() => Math.random() - 0.5);
    await setDraftOrder(shuffled);
  };

  const setDraftOrder = useCallback(async (draftOrder: Player[]) => {
    if (!sessionId) return;

    // Optimistic UI update so buttons feel responsive even if realtime isn't firing
    setState((prev) => ({ ...prev, draftOrder }));

    // Delete teams no longer in the order
    if (draftOrder.length > 0) {
      const { error: deleteError } = await supabase
        .from("draft_order")
        .delete()
        .eq("session_id", sessionId)
        .not("player_name", "in", `(${draftOrder.map(p => `"${p}"`).join(",")})`);

      if (deleteError) {
        console.error("Failed to clean draft order:", deleteError);
      }

      // Upsert current order (atomic, idempotent)
      const rows = draftOrder.map((player, index) => ({
        session_id: sessionId,
        player_name: player,
        position: index,
      }));

      const { error: upsertError } = await supabase
        .from("draft_order")
        .upsert(rows, { onConflict: "session_id,player_name" });

      if (upsertError) {
        console.error("Failed to upsert draft order:", upsertError);
        toast.error("Failed to save draft order");
      }
    } else {
      // Empty order: delete all
      const { error: deleteError } = await supabase
        .from("draft_order")
        .delete()
        .eq("session_id", sessionId);

      if (deleteError) {
        console.error("Failed to clear draft order:", deleteError);
        toast.error("Failed to save draft order");
      }
    }
  }, [sessionId]);


  const setDraftType = async (draftType: DraftType) => {
    if (!sessionId) return;

    // Optimistic UI update
    setState((prev) => ({ ...prev, draftType }));

    const { error } = await supabase
      .from("game_sessions")
      .update({ draft_type: draftType })
      .eq("id", sessionId);

    if (error) {
      console.error("Failed to update draft type:", error);
      toast.error("Failed to update draft type");
      // Re-sync local state from DB
      await loadGameState(sessionId);
    }
  };

  const isDraftingRef = useRef(false);

  const draftContestant = async (contestantId: string) => {
    if (!sessionId) return;
    if (isDraftingRef.current) return;
    isDraftingRef.current = true;

    try {
      // Read fresh draft index from DB to avoid stale React state
      const { data: freshSession } = await supabase
        .from("game_sessions")
        .select("current_draft_index")
        .eq("id", sessionId)
        .single();

      if (!freshSession) return;

      const currentDraftIndex = freshSession.current_draft_index;
      const { draftOrder, draftType, gameType, picksPerTeam: explicitPicks } = state;
      const teamCount = draftOrder.length;
      const { getPicksPerTeam } = await import("@/lib/picksPerTeam");
      const picksPerTeam = getPicksPerTeam(explicitPicks, gameType, state.contestants.length, teamCount);
      const totalPicks = teamCount * picksPerTeam;

      if (currentDraftIndex >= totalPicks || teamCount === 0) return;

      // Determine owner using snake draft logic
      let owner: Player;
      if (draftType === "snake") {
        const round = Math.floor(currentDraftIndex / teamCount);
        const posInRound = currentDraftIndex % teamCount;
        owner = round % 2 === 0 ? draftOrder[posInRound] : draftOrder[teamCount - 1 - posInRound];
        console.log(`Snake draft - Pick ${currentDraftIndex + 1}: Round ${round}, Pos ${posInRound}, Owner: ${owner}`);
      } else {
        owner = draftOrder[currentDraftIndex % teamCount];
      }

      const pickNumber = currentDraftIndex + 1;

      console.log(`Drafting contestant ${contestantId} to ${owner} as pick #${pickNumber}`);

      // Use atomic RPC to prevent race conditions
      const { data: success, error } = await supabase.rpc('execute_draft_pick', {
        _session_id: sessionId,
        _contestant_id: contestantId,
        _owner: owner,
        _pick_number: pickNumber,
        _expected_index: currentDraftIndex,
      });

      if (error) {
        console.error("Draft pick RPC error:", error);
        toast.error("Failed to make pick. Please try again.");
        await loadGameState(sessionId);
        return;
      }

      if (!success) {
        console.warn("Draft pick conflict - index mismatch, reloading state");
        toast.error("Pick conflict — someone else picked at the same time. Please try again.");
        await loadGameState(sessionId);
        return;
      }

      // Optimistic UI update — show the pick instantly without waiting for realtime
      setState((prev) => ({
        ...prev,
        currentDraftIndex: currentDraftIndex + 1,
        contestants: prev.contestants.map((c) =>
          c.id === contestantId ? { ...c, owner, pickNumber } : c
        ),
      }));
    } finally {
      isDraftingRef.current = false;
    }
  };

  const undoDraftPick = async () => {
    if (!sessionId || state.currentDraftIndex === 0) return;

    // Find the most recently drafted contestant
    const lastDrafted = state.contestants
      .filter((c) => c.owner && c.pickNumber)
      .sort((a, b) => (b.pickNumber || 0) - (a.pickNumber || 0))[0];

    if (!lastDrafted) return;

    await Promise.all([
      supabase.from("contestants").update({ owner: null, pick_number: null }).eq("id", lastDrafted.id),
      supabase.from("game_sessions").update({ current_draft_index: state.currentDraftIndex - 1 }).eq("id", sessionId),
    ]);
  };

  const addScoringEvent = async (
    contestantId: string,
    contestantName: string,
    action: string,
    points: number
  ) => {
    if (!sessionId) return;

    await supabase.from("scoring_events").insert({
      session_id: sessionId,
      contestant_id: contestantId,
      contestant_name: contestantName,
      action,
      points,
      episode: state.episode,
    });

    if (action.includes("Quit") || action.includes("Voted Out")) {
      await updateContestant(contestantId, { isEliminated: true });
    }

    if (action.includes("Cry")) {
      await supabase.from("crying_contestants").insert({
        session_id: sessionId,
        contestant_id: contestantId,
        episode: state.episode,
      });
    }
  };

  const undoLastEvent = async () => {
    if (!sessionId || state.scoringEvents.length === 0) return;

    const lastEvent = state.scoringEvents[state.scoringEvents.length - 1];
    
    // Delete the scoring event
    await supabase.from("scoring_events").delete().eq("id", lastEvent.id);

    // If the event was a crying event, remove from crying contestants
    if (lastEvent.action.includes("Cry")) {
      await supabase.from("crying_contestants")
        .delete()
        .eq("contestant_id", lastEvent.contestantId)
        .eq("episode", state.episode);
    }

    // If the event was elimination, un-eliminate the contestant
    if (lastEvent.action.includes("Quit") || lastEvent.action.includes("Voted Out")) {
      await supabase.from("contestants")
        .update({ is_eliminated: false })
        .eq("id", lastEvent.contestantId);
    }

    // Deletes don't always come back through realtime, so refresh now
    debouncedReload();
  };

  const undoEvent = async (eventId: string) => {
    if (!sessionId) return;

    const event = state.scoringEvents.find(e => e.id === eventId);
    if (!event) return;
    
    // Delete the scoring event
    await supabase.from("scoring_events").delete().eq("id", eventId);

    // If the event was a crying event, remove from crying contestants
    if (event.action.includes("Cry")) {
      await supabase.from("crying_contestants")
        .delete()
        .eq("contestant_id", event.contestantId)
        .eq("episode", event.episode);
    }

    // If the event was elimination, un-eliminate the contestant
    if (event.action.includes("Quit") || event.action.includes("Voted Out")) {
      await supabase.from("contestants")
        .update({ is_eliminated: false })
        .eq("id", event.contestantId);
    }

    // Deletes don't always come back through realtime, so refresh now
    debouncedReload();
  };

  /**
   * Auto-scoring: add one episode's planned events in a single batch, mark castaways out,
   * and move the league to that episode (and post-merge) if it's behind. Returns events added.
   */
  const applyEpisodeResults = async (
    episode: number,
    events: { contestantId: string; contestantName: string; action: string; points: number }[],
    eliminateIds: string[],
    postMerge: boolean
  ): Promise<number> => {
    if (!sessionId) throw new Error("No active season");
    if (events.length > 0) {
      const { error } = await supabase.from("scoring_events").insert(
        events.map((e) => ({
          session_id: sessionId,
          contestant_id: e.contestantId,
          contestant_name: e.contestantName,
          action: e.action,
          points: e.points,
          episode,
        }))
      );
      if (error) throw error;
    }
    if (eliminateIds.length > 0) {
      const { error } = await supabase.from("contestants").update({ is_eliminated: true }).in("id", eliminateIds);
      if (error) throw error;
    }
    const sessionUpdates: Record<string, unknown> = {};
    if (state.episode < episode) sessionUpdates.episode = episode;
    if (postMerge && !state.isPostMerge) sessionUpdates.is_post_merge = true;
    if (Object.keys(sessionUpdates).length > 0) {
      await supabase.from("game_sessions").update(sessionUpdates as any).eq("id", sessionId);
    }
    debouncedReload();
    return events.length;
  };

  const exportData = () => {
    const dataStr = JSON.stringify(
      {
        ...state,
        cryingThisEpisode: Array.from(state.cryingThisEpisode),
      },
      null,
      2
    );
    const dataUri = "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
    const exportFileDefaultName = `survivor-s${state.season}-ep${state.episode}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
  };

  const importData = async (jsonString: string) => {
    try {
      const parsed = JSON.parse(jsonString);
      
      if (!sessionId) return;

      // Update session data
      await supabase.from("game_sessions").update({
        season: parsed.season,
        episode: parsed.episode,
        mode: parsed.mode,
        is_post_merge: parsed.isPostMerge,
        draft_type: parsed.draftType,
        current_draft_index: parsed.currentDraftIndex,
      }).eq("id", sessionId);

      // Update contestants
      await setContestants(parsed.contestants);

      // Update draft order
      await setDraftOrder(parsed.draftOrder);

      // Update scoring events
      await supabase.from("scoring_events").delete().eq("session_id", sessionId);
      if (parsed.scoringEvents.length > 0) {
        await supabase.from("scoring_events").insert(
          parsed.scoringEvents.map((e: ScoringEvent) => ({
            session_id: sessionId,
            contestant_id: e.contestantId,
            contestant_name: e.contestantName,
            action: e.action,
            points: e.points,
            episode: e.episode,
          }))
        );
      }

      toast.success("Data imported successfully");
    } catch (error) {
      console.error("Error importing data:", error);
      toast.error("Failed to import data");
      throw error;
    }
  };

  const updatePlayerAvatar = async (player: Player, avatar: string) => {
    if (!sessionId) return;
    
    await supabase.from("player_profiles").upsert({
      session_id: sessionId,
      player_name: player,
      avatar,
    }, {
      onConflict: "session_id,player_name",
    });
  };

  const clearScores = async () => {
    if (!sessionId) return;
    await Promise.all([
      supabase.from("scoring_events").delete().eq("session_id", sessionId),
      supabase.from("crying_contestants").delete().eq("session_id", sessionId),
    ]);
  };

  const clearEpisodeScores = async (episode: number) => {
    if (!sessionId) return;
    await supabase.from("scoring_events").delete().eq("session_id", sessionId).eq("episode", episode);
  };

  const clearHistory = async () => {
    // Only this league's history. (This used to delete every league's archived seasons.)
    if (!leagueId) return;
    await supabase.from("archived_seasons").delete().eq("league_id", leagueId);
  };

  const resetAll = async () => {
    if (!sessionId) return;
    
    await Promise.all([
      supabase.from("contestants").delete().eq("session_id", sessionId),
      supabase.from("scoring_events").delete().eq("session_id", sessionId),
      supabase.from("crying_contestants").delete().eq("session_id", sessionId),
      supabase.from("game_sessions").update({
        season: state.season,
        episode: 1,
        mode: "setup",
        is_post_merge: false,
        draft_type: "snake",
        current_draft_index: 0,
      }).eq("id", sessionId),
    ]);
  };

  // Archive the current season (if anyone drafted) and start a fresh session for the
  // next season. Nothing is deleted: the old session stays in the database untouched.
  // Teams, members and scoring settings carry over automatically (they live on the league).
  const startNewSeason = async (
    targetSeason?: number
  ): Promise<{ result: "started" | "switched" | "failed"; castImported: number }> => {
    if (!leagueId || !sessionId) return { result: "failed", castImported: 0 };

    const endingSeason = state.season;
    const nextSeason =
      targetSeason && targetSeason > endingSeason ? targetSeason : endingSeason + 1;

    try {
      // 0. If another device already started a newer season, switch to it instead
      const { data: newest, error: newestError } = await supabase
        .from("game_sessions")
        .select("id")
        .eq("league_id", leagueId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (newestError) throw newestError;
      if (newest && newest.id !== sessionId) {
        setSessionId(newest.id);
        setSessionStatus("active");
        await loadGameState(newest.id);
        toast.info("A new season was already started for this league. You're on it now.");
        return { result: "switched", castImported: 0 };
      }

      // 1. Save final standings to History (once per season)
      if (state.contestants.some((c) => c.owner)) {
        const { data: existingArchive, error: archiveCheckError } = await supabase
          .from("archived_seasons")
          .select("id")
          .eq("league_id", leagueId)
          .eq("season", endingSeason)
          .limit(1)
          .maybeSingle();
        if (archiveCheckError) throw archiveCheckError;

        if (!existingArchive) {
          const leaderboard = state.draftOrder
            .map((player) => {
              const playerContestants = state.contestants.filter((c) => c.owner === player);
              const contestantIds = playerContestants.map((c) => c.id);
              const score = state.scoringEvents
                .filter((e) => contestantIds.includes(e.contestantId))
                .reduce((sum, e) => sum + e.points, 0);
              return {
                player,
                score,
                activeCount: playerContestants.filter((c) => !c.isEliminated).length,
              };
            })
            .sort((a, b) => b.score - a.score);

          const { error: archiveError } = await supabase.from("archived_seasons").insert({
            season: endingSeason,
            contestants: state.contestants as any,
            scoring_events: state.scoringEvents as any,
            final_standings: leaderboard as any,
            archived_at: Date.now(),
            league_id: leagueId,
          });
          if (archiveError) throw archiveError;

          trackEvent("season_ended", {
            league_id: leagueId,
            league_name: leagueId,
            winner_name: leaderboard[0]?.player || "Unknown",
            season: endingSeason,
            next_season: nextSeason,
            total_rounds: state.episode,
          });
        }
      }

      // 2. Close out the old session
      const { error: completeError } = await supabase
        .from("game_sessions")
        .update({ status: "completed" } as any)
        .eq("id", sessionId);
      if (completeError) throw completeError;

      // 3. Open a brand-new session for the next season
      const { data: newSession, error: createError } = await supabase
        .from("game_sessions")
        .insert({
          league_id: leagueId,
          mode: "setup",
          season: nextSeason,
          episode: 1,
          is_post_merge: false,
          draft_type: state.draftType || "snake",
          current_draft_index: 0,
          status: "active",
          game_type: state.gameType,
          picks_per_team: state.picksPerTeam,
        } as any)
        .select()
        .single();
      if (createError || !newSession) throw createError || new Error("No session returned");

      // 4. Bring in the official cast for the new season, if it's been published.
      //    A failure here shouldn't undo the rollover; the Draft tab offers the import again.
      let castImported = 0;
      try {
        castImported = await importOfficialCast(newSession.id, nextSeason);
      } catch (castError) {
        console.error("Error importing official cast:", castError);
      }

      // 5. Switch the app over to it
      localStorage.setItem(LOCAL_MODE_KEY, "setup");
      setSessionId(newSession.id);
      setSessionStatus("active");
      await loadGameState(newSession.id);
      return { result: "started", castImported };
    } catch (error) {
      console.error("Error starting new season:", error);
      toast.error("Couldn't start the new season. Nothing was deleted, so it's safe to try again.");
      return { result: "failed", castImported: 0 };
    }
  };

  // One-click import of the official cast into an empty session (Draft tab empty state).
  const importOfficialCastForSession = async (): Promise<number> => {
    if (!sessionId) return 0;
    try {
      const added = await importOfficialCast(sessionId, state.season);
      if (added > 0) {
        await loadGameState(sessionId);
        toast.success(`Added the ${added} official Season ${state.season} castaways.`);
      } else {
        toast.error(`The official Season ${state.season} cast isn't available yet. You can add castaways in Admin.`);
      }
      return added;
    } catch (error) {
      console.error("Error importing official cast:", error);
      toast.error("Couldn't import the cast. Please try again.");
      return 0;
    }
  };

  const revertToSetup = async () => {
    if (!sessionId) return;

    // Reset draft index
    await supabase
      .from("game_sessions")
      .update({ current_draft_index: 0 })
      .eq("id", sessionId);

    // Clear all draft assignments
    await supabase
      .from("contestants")
      .update({ owner: null, pick_number: null })
      .eq("session_id", sessionId);

    // Reset local mode
    localStorage.setItem(LOCAL_MODE_KEY, "setup");

    // Reload state
    await loadGameState(sessionId);
    toast.success("Draft reverted to setup. All picks have been cleared.");
  };

  return {
    state,
    loading,
    sessionId,
    sessionStatus,
    scoringConfig,
    setScoringConfig,
    setState,
    startNewSeason,
    importOfficialCast: importOfficialCastForSession,
    revertToSetup,
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
    addScoringEvent,
    undoLastEvent,
    undoEvent,
    applyEpisodeResults,
    exportData,
    importData,
    updatePlayerAvatar,
    clearScores,
    clearEpisodeScores,
    clearHistory,
    resetAll,
    setGameType: async (gameType: GameType) => {
      if (!sessionId) return;
      await supabase.from("game_sessions").update({ game_type: gameType } as any).eq("id", sessionId);
      setState((prev) => ({ ...prev, gameType }));
    },
    setPicksPerTeam: async (picksPerTeam: number | null) => {
      if (!sessionId) return;
      await supabase.from("game_sessions").update({ picks_per_team: picksPerTeam } as any).eq("id", sessionId);
      setState((prev) => ({ ...prev, picksPerTeam }));
    },
    manualAssign: async (contestantId: string, teamName: string) => {
      if (!sessionId) return;
      if (teamName) {
        await supabase.from("contestants").update({ owner: teamName }).eq("id", contestantId);
      } else {
        await supabase.from("contestants").update({ owner: null, pick_number: null }).eq("id", contestantId);
      }
    },
    manualFinalize: async () => {
      if (!sessionId) return;
      // Count assigned contestants and set draft index to that count
      const { data: assigned } = await supabase
        .from("contestants")
        .select("id")
        .eq("session_id", sessionId)
        .not("owner", "is", null);
      const totalAssigned = assigned?.length || 0;
      // Set pick_number for all assigned contestants
      const { data: allContestants } = await supabase
        .from("contestants")
        .select("*")
        .eq("session_id", sessionId)
        .not("owner", "is", null)
        .order("created_at", { ascending: true });
      if (allContestants) {
        for (let i = 0; i < allContestants.length; i++) {
          if (!allContestants[i].pick_number) {
            await supabase.from("contestants").update({ pick_number: i + 1 }).eq("id", allContestants[i].id);
          }
        }
      }
      await supabase.from("game_sessions").update({ current_draft_index: totalAssigned }).eq("id", sessionId);
      await loadGameState(sessionId);
    },
  };
};
