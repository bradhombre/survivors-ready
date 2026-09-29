import { useEffect, useMemo, useState } from "react";
import { draftPoolSize, getPicksPerTeam } from "@/lib/picksPerTeam";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Shuffle, Upload, Download, Trash2, Play, List, GripVertical, Pencil, Check, X, Plus, Minus, Users, Copy, UserPlus, ArrowUp, ArrowDown } from "lucide-react";
import { Player, Contestant, DraftType } from "@/types/survivor";
import { useToast } from "@/hooks/use-toast";
import { useLeagueTeams } from "@/hooks/useLeagueTeams";
import { useLeagueRole } from "@/hooks/useLeagueRole";
import { supabase } from "@/integrations/supabase/client";
import { TeamAvatar } from "./TeamAvatar";
import { trackEvent } from "@/lib/customerio";

interface LeagueMember {
  user_id: string;
  email: string;
  display_name: string | null;
}

interface SetupModeProps {
  leagueId: string;
  season: number;
  contestants: Contestant[];
  draftOrder: Player[];
  draftType: DraftType;
  onSeasonChange: (season: number) => void;
  onAddContestant: (name: string, tribe?: string, age?: number, location?: string) => void;
  onUpdateContestant: (id: string, updates: Partial<Contestant>) => void;
  onDeleteContestant: (id: string) => void;
  onRandomizeDraftOrder: () => void;
  onSetDraftOrder: (order: Player[]) => void;
  onDraftTypeChange: (type: DraftType) => void;
  onStartDraft: () => void;
  onImport: (data: string) => void;
  onExport: () => void;
  onSetContestants: (contestants: Contestant[]) => void;
  picksPerTeam?: number | null;
  onSetPicksPerTeam?: (picks: number | null) => void;
}

export const SetupMode = ({
  leagueId,
  season,
  contestants,
  draftOrder,
  draftType,
  onSeasonChange,
  onAddContestant,
  onUpdateContestant,
  onDeleteContestant,
  onRandomizeDraftOrder,
  onSetDraftOrder,
  onDraftTypeChange,
  onStartDraft,
  onImport,
  onExport,
  onSetContestants,
  picksPerTeam: explicitPicks,
  onSetPicksPerTeam,
}: SetupModeProps) => {
  const [name, setName] = useState("");
  const [tribe, setTribe] = useState("");
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTribe, setEditTribe] = useState("");
  const [editAge, setEditAge] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const { toast } = useToast();

  // Team management state
  const { teams, loading: teamsLoading, resizeLeague, renameTeam, getFilledCount, refetch } = useLeagueTeams({ leagueId });
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editTeamName, setEditTeamName] = useState("");
  const [isResizing, setIsResizing] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [isImportingCast, setIsImportingCast] = useState(false);
  const [leagueMembers, setLeagueMembers] = useState<LeagueMember[]>([]);
  const [assigningTeamId, setAssigningTeamId] = useState<string | null>(null);
  const { isLeagueAdmin } = useLeagueRole(leagueId);

  const teamByName = useMemo(() => {
    const map = new Map<string, (typeof teams)[number]>();
    teams.forEach((t) => map.set(t.name, t));
    return map;
  }, [teams]);

  // Fetch league members for assignment dropdown
  useEffect(() => {
    if (!leagueId || !isLeagueAdmin) return;
    const fetchMembers = async () => {
      const { data: memberships } = await supabase
        .from('league_memberships')
        .select('user_id')
        .eq('league_id', leagueId);
      if (!memberships) return;
      const userIds = memberships.map(m => m.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, display_name')
        .in('id', userIds);
      if (profiles) {
        setLeagueMembers(profiles.map(p => ({ user_id: p.id, email: p.email, display_name: p.display_name })));
      }
    };
    fetchMembers();
  }, [leagueId, isLeagueAdmin, teams]);

  // Fetch invite code
  useState(() => {
    const fetchInviteCode = async () => {
      const { data } = await supabase
        .from('leagues')
        .select('invite_code')
        .eq('id', leagueId)
        .maybeSingle();
      if (data) setInviteCode(data.invite_code);
    };
    fetchInviteCode();
  });

  const filledCount = getFilledCount();
  const leagueSize = teams.length;

  const handleResizeLeague = async (delta: number) => {
    const newSize = leagueSize + delta;
    if (newSize < 2 || newSize > 20) return;
    if (newSize < filledCount) {
      toast({ 
        title: "Cannot shrink league", 
        description: `${filledCount} slots are already filled.`, 
        variant: "destructive" 
      });
      return;
    }

    setIsResizing(true);
    try {
      await resizeLeague(newSize);
      toast({ title: `League size updated to ${newSize}` });
    } catch (err: any) {
      toast({ title: "Failed to resize league", description: err.message, variant: "destructive" });
    } finally {
      setIsResizing(false);
    }
  };

  // Keep draft order aligned with team slots when league size changes (preserve any manual reordering)
  useEffect(() => {
    if (teams.length === 0) return;

    const teamNames = teams.map((t) => t.name);
    const current = draftOrder as string[];

    const hasMismatch =
      current.length !== teamNames.length ||
      current.some((name) => !teamNames.includes(name)) ||
      teamNames.some((name) => !current.includes(name));

    if (!hasMismatch) return;

    const merged = current.filter((name) => teamNames.includes(name));
    teamNames.forEach((name) => {
      if (!merged.includes(name)) merged.push(name);
    });

    onSetDraftOrder(merged as Player[]);
  }, [teams, draftOrder, onSetDraftOrder]);

  const handleRenameTeam = async (teamId: string, oldName: string) => {
    const trimmedName = editTeamName.trim();
    if (!trimmedName || trimmedName === oldName) {
      setEditingTeamId(null);
      return;
    }

    if (trimmedName.length < 2) {
      toast({ title: "Team name must be at least 2 characters", variant: "destructive" });
      return;
    }

    if (teams.some(t => t.id !== teamId && t.name.toLowerCase() === trimmedName.toLowerCase())) {
      toast({ title: "Team name already exists", variant: "destructive" });
      return;
    }

    try {
      await renameTeam(teamId, trimmedName, oldName);
      // Update local draft order state (DB is updated by renameTeam)
      onSetDraftOrder(draftOrder.map(p => p === oldName ? trimmedName : p));
      setEditingTeamId(null);
      toast({ title: "Team renamed!", description: `Renamed to ${trimmedName}.` });
    } catch (err) {
      toast({ title: "Failed to rename team", variant: "destructive" });
    }
  };

  const copyInviteLink = () => {
    if (!inviteCode) return;
    const link = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard.writeText(link);
    toast({ title: "Invite link copied!" });
    trackEvent('league_invite_sent', {
      league_name: leagueId,
      invite_url: link,
    });
  };

  const handleAssignMember = async (teamId: string, userId: string | null) => {
    try {
      // If assigning a user, first clear them from any other team in this league
      if (userId) {
        const existingTeam = teams.find(t => t.user_id === userId);
        if (existingTeam && existingTeam.id !== teamId) {
          await supabase
            .from('league_teams')
            .update({ user_id: null })
            .eq('id', existingTeam.id);
        }
      }
      // Update the target team
      await supabase
        .from('league_teams')
        .update({ user_id: userId })
        .eq('id', teamId);
      
      // Force immediate refresh of team data
      await refetch();
      
      setAssigningTeamId(null);
      toast({ title: userId ? "Member assigned!" : "Slot unassigned" });
    } catch (err: any) {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    }
  };

  const handleAddContestant = () => {
    if (!name.trim()) return;
    onAddContestant(
      name.trim(), 
      tribe.trim() || undefined,
      age ? Number(age) : undefined,
      location.trim() || undefined
    );
    setName("");
    setTribe("");
    setAge("");
    setLocation("");
  };

  const handleBulkImport = () => {
    if (!bulkText.trim()) return;

    const lines = bulkText.split('\n').filter(line => line.trim());
    let addedCount = 0;

    lines.forEach((line) => {
      const parts = line.split(',').map(p => p.trim());
      const contestantName = parts[0];
      const contestantAge = parts[1] ? Number(parts[1]) : undefined;
      const contestantLocation = parts[2] || undefined;
      const contestantTribe = parts[3] || undefined;

      if (contestantName) {
        onAddContestant(contestantName, contestantTribe, contestantAge, contestantLocation);
        addedCount++;
      }
    });

    setBulkText("");
    setShowBulkImport(false);
    toast({
      title: `${addedCount} contestants added`,
      description: "Bulk import successful.",
    });
  };

  const handleCSVFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const csvData = event.target?.result as string;
        const lines = csvData.split('\n').filter(line => line.trim());
        
        const startIndex = lines[0].toLowerCase().includes('name') ? 1 : 0;
        let addedCount = 0;

        for (let i = startIndex; i < lines.length; i++) {
          const parts = lines[i].split(',').map(p => p.trim());
          const contestantName = parts[0];
          const contestantAge = parts[1] ? Number(parts[1]) : undefined;
          const contestantLocation = parts[2] || undefined;
          const contestantTribe = parts[3] || undefined;

          if (contestantName) {
            onAddContestant(contestantName, contestantTribe, contestantAge, contestantLocation);
            addedCount++;
          }
        }

        toast({
          title: `${addedCount} contestants imported`,
          description: "CSV import successful.",
        });
      } catch (error) {
        toast({
          title: "Import failed",
          description: "Invalid CSV format.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result as string;
        onImport(data);
        toast({
          title: "Import successful",
          description: "Season data loaded.",
        });
      } catch (error) {
        toast({
          title: "Import failed",
          description: "Invalid file format.",
          variant: "destructive",
        });
      }
    };
    reader.readAsText(file);
  };

  const teamCount = teams.length || 1;
  // Use a passed gameType or default to "full" for picks calculation
  // Castaways who went home before the league's first episode don't count toward the draft
  const poolSize = draftPoolSize(contestants);
  const computedPicks = getPicksPerTeam(explicitPicks, "full", poolSize, teamCount);
  const minContestants = computedPicks * teamCount;
  const canStartDraft = poolSize >= minContestants && !contestants.some((c) => c.owner);
  const suggestedPicks = teamCount > 0 ? Math.max(1, Math.floor(poolSize / teamCount)) : 1;

  // Import official cast from master_contestants table
  const handleImportOfficialCast = async () => {
    setIsImportingCast(true);
    try {
      // Fetch master cast for this season
      const { data: masterCast, error } = await supabase
        .from("master_contestants")
        .select("name, tribe, age, occupation, image_url")
        .eq("season_number", season);

      if (error) throw error;

      if (!masterCast || masterCast.length === 0) {
        toast({
          title: `Official cast not available yet for Season ${season}`,
          description: "Try adding contestants manually or check back later.",
          variant: "destructive",
        });
        setIsImportingCast(false);
        return;
      }

      // Check for duplicates
      const existingNames = new Set(contestants.map((c) => c.name.toLowerCase()));
      const toImport = masterCast.filter(
        (mc) => !existingNames.has(mc.name.toLowerCase())
      );

      if (toImport.length === 0) {
        toast({
          title: "All contestants already exist",
          description: `${masterCast.length} contestants from Season ${season} are already in your list.`,
        });
        setIsImportingCast(false);
        return;
      }

      // Add each contestant (using onAddContestant which doesn't support image_url,
      // so we'll insert directly to DB for image_url support)
      for (const mc of toImport) {
        onAddContestant(mc.name, mc.tribe || undefined, mc.age || undefined, mc.occupation || undefined);
      }

      // Update image_url for imported contestants that have images
      // We need to do this after insertion since onAddContestant doesn't support image_url
      if (toImport.some(mc => mc.image_url)) {
        // Small delay to let the contestants be created
        setTimeout(async () => {
          const { data: sessionData } = await supabase
            .from("game_sessions")
            .select("id")
            .eq("league_id", leagueId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (sessionData) {
            for (const mc of toImport) {
              if (mc.image_url) {
                await supabase
                  .from("contestants")
                  .update({ image_url: mc.image_url })
                  .eq("session_id", sessionData.id)
                  .eq("name", mc.name);
              }
            }
          }
        }, 1000);
      }

      toast({
        title: `Imported ${toImport.length} contestants for Season ${season}`,
        description:
          toImport.length < masterCast.length
            ? `${masterCast.length - toImport.length} duplicates were skipped.`
            : undefined,
      });
    } catch (err) {
      console.error("Error importing cast:", err);
      toast({
        title: "Import failed",
        description: "Could not import official cast. Try again later.",
        variant: "destructive",
      });
    }
    setIsImportingCast(false);
  };

  // Editing contestant handlers
  const startEditing = (contestant: Contestant) => {
    setEditingId(contestant.id);
    setEditName(contestant.name);
    setEditTribe(contestant.tribe || "");
    setEditAge(contestant.age?.toString() || "");
    setEditLocation(contestant.location || "");
  };

  const saveEdit = (id: string) => {
    if (!editName.trim()) return;
    onUpdateContestant(id, {
      name: editName.trim(),
      tribe: editTribe.trim() || undefined,
      age: editAge ? Number(editAge) : undefined,
      location: editLocation.trim() || undefined,
    });
    setEditingId(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  return (
    <div className="max-w-6xl mx-auto py-2 md:py-4 space-y-8">
      <div className="space-y-2">
        <p className="label-caps text-muted-foreground">Season <span className="tabular">{season}</span></p>
        <h1 className="font-display text-4xl md:text-5xl leading-none text-primary">
          Season setup
        </h1>
        <p className="text-muted-foreground">Set up your season, then run the draft.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Season & Quick Actions */}
        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-display text-3xl leading-none">Season</h2>
          
          <div>
            <Label htmlFor="season" className="label-caps text-muted-foreground">Season number</Label>
            <Input
              id="season"
              type="number"
              value={season}
              onChange={(e) => onSeasonChange(Number(e.target.value))}
              className="mt-2 tabular"
            />
          </div>

          <div className="space-y-2">
            <div className="flex gap-2">
              <Button onClick={onExport} variant="outline" className="flex-1">
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
              <Button variant="outline" className="flex-1" asChild>
                <label htmlFor="import-file" className="cursor-pointer">
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                  <input
                    id="import-file"
                    type="file"
                    accept=".json"
                    onChange={handleFileImport}
                    className="hidden"
                  />
                </label>
              </Button>
            </div>
          </div>
        </Card>

        {/* League Size & Members */}
        <Card className="p-4 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-3xl leading-none">League size</h2>
            <span className="label-caps text-muted-foreground tabular">
              {filledCount}/{leagueSize} filled
            </span>
          </div>

          {teamsLoading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : (
            <>
              {/* Size controls */}
              <div className="flex items-center justify-center gap-4">
                <Button
                  onClick={() => handleResizeLeague(-1)}
                  variant="outline"
                  size="icon"
                  disabled={isResizing || leagueSize <= 2 || leagueSize <= filledCount}
                  aria-label="Remove a team slot"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <span className="text-4xl font-black tabular text-primary min-w-[60px] text-center">
                  {leagueSize}
                </span>
                <Button
                  onClick={() => handleResizeLeague(1)}
                  variant="outline"
                  size="icon"
                  disabled={isResizing || leagueSize >= 20}
                  aria-label="Add a team slot"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>

              {/* Team slots */}
              <div className="space-y-2">
                {teams.map((team) => {
                  const isEditing = editingTeamId === team.id;
                  const isFilled = !!team.user_id;

                  return (
                    <div key={team.id} className="glass rounded-[12px] p-3 min-h-[44px] flex items-center gap-3">
                      <TeamAvatar 
                        teamName={team.name} 
                        avatarUrl={team.avatar_url} 
                        size="sm"
                      />
                      <span className="font-black tabular text-primary w-6">{team.position}.</span>
                      
                      {isEditing ? (
                        <div className="flex-1 flex items-center gap-2">
                          <Input
                            value={editTeamName}
                            onChange={(e) => setEditTeamName(e.target.value)}
                            className="h-9 flex-1"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleRenameTeam(team.id, team.name);
                              if (e.key === "Escape") setEditingTeamId(null);
                            }}
                          />
                          <Button onClick={() => handleRenameTeam(team.id, team.name)} size="sm" variant="default" aria-label="Save team name">
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button onClick={() => setEditingTeamId(null)} size="sm" variant="ghost" aria-label="Cancel rename">
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0">
                            <span className="font-bold">{team.name}</span>
                            {isFilled ? (
                              <span className="text-xs text-muted-foreground ml-2">
                                — {team.user_email || 'Assigned'}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground ml-2 italic">
                                (unassigned)
                              </span>
                            )}
                          </div>
                          {isLeagueAdmin && (
                            <Select
                              value={team.user_id || "__unassigned__"}
                              onValueChange={(val) => handleAssignMember(team.id, val === "__unassigned__" ? null : val)}
                            >
                              <SelectTrigger className="w-[140px] h-9 text-xs">
                                <SelectValue placeholder="Assign" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__unassigned__">
                                  <span className="italic text-muted-foreground">Unassign</span>
                                </SelectItem>
                                {leagueMembers.map((member) => {
                                  const assignedElsewhere = teams.find(t => t.user_id === member.user_id && t.id !== team.id);
                                  return (
                                    <SelectItem key={member.user_id} value={member.user_id} disabled={!!assignedElsewhere}>
                                      {member.display_name || member.email}
                                      {assignedElsewhere ? ` (${assignedElsewhere.name})` : ''}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )}
                          <Button
                            onClick={() => {
                              setEditingTeamId(team.id);
                              setEditTeamName(team.name);
                            }}
                            size="sm"
                            variant="ghost"
                            aria-label={`Rename ${team.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Invite code */}
              {inviteCode && (
                <div className="pt-4 border-t border-border">
                  <Label className="label-caps text-muted-foreground">Invite code</Label>
                  <div className="flex items-center gap-2 mt-2">
                    <code className="glass rounded-[10px] px-3 py-2 font-mono text-lg font-bold tracking-widest flex-1 text-center">
                      {inviteCode}
                    </code>
                    <Button onClick={copyInviteLink} variant="outline" size="icon" aria-label="Copy invite link">
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Share this code. Users are auto-assigned to the next open slot when they join.
                  </p>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Draft Settings */}
        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-display text-3xl leading-none">Draft settings</h2>

          <div>
            <Label className="label-caps text-muted-foreground">Draft order (use the arrows to reorder)</Label>
            <div className="space-y-2 mt-2">
              {draftOrder.map((player, index) => {
                const team = teamByName.get(String(player));
                const isFilled = !!team?.user_id;

                return (
                  <div key={`${String(player)}-${index}`} className="glass rounded-[12px] p-3 min-h-[44px] flex items-center gap-3">
                    <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="font-black tabular text-primary w-6">{index + 1}</span>

                    <div className="flex-1 min-w-0">
                      <span className="font-bold truncate">{String(player)}</span>
                      {team?.user_email && (
                        <span className="text-xs text-muted-foreground ml-2">({team.user_email})</span>
                      )}
                    </div>

                    <div className="flex gap-1">
                      {index > 0 && (
                        <Button
                          onClick={() => {
                            const newOrder = [...draftOrder];
                            [newOrder[index], newOrder[index - 1]] = [newOrder[index - 1], newOrder[index]];
                            onSetDraftOrder(newOrder);
                          }}
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${String(player)} up`}
                        >
                          <ArrowUp className="h-4 w-4" />
                        </Button>
                      )}
                      {index < draftOrder.length - 1 && (
                        <Button
                          onClick={() => {
                            const newOrder = [...draftOrder];
                            [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
                            onSetDraftOrder(newOrder);
                          }}
                          size="sm"
                          variant="ghost"
                          aria-label={`Move ${String(player)} down`}
                        >
                          <ArrowDown className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <Button onClick={onRandomizeDraftOrder} variant="outline" className="w-full mt-3">
              <Shuffle className="mr-2 h-4 w-4" />
              Randomize order
            </Button>
          </div>

          <div>
            <Label className="label-caps text-muted-foreground">Draft type</Label>
            <div className="flex gap-2 mt-2">
              <Button
                onClick={() => onDraftTypeChange("snake")}
                variant={draftType === "snake" ? "default" : "outline"}
                className="flex-1"
              >
                Snake
              </Button>
              <Button
                onClick={() => onDraftTypeChange("linear")}
                variant={draftType === "linear" ? "default" : "outline"}
                className="flex-1"
              >
                Linear
              </Button>
            </div>
          </div>

          {/* Picks Per Team */}
          <div className="space-y-2">
            <Label className="label-caps text-muted-foreground">Picks per team</Label>
            <p className="text-xs text-muted-foreground tabular">
              Suggested: {suggestedPicks} ({poolSize} contestants / {teamCount} teams)
            </p>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={1}
                max={poolSize || 20}
                value={explicitPicks ?? suggestedPicks}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val) && val >= 1) {
                    onSetPicksPerTeam?.(val);
                  }
                }}
                className="w-24 tabular"
              />
              {explicitPicks !== null && explicitPicks !== undefined && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onSetPicksPerTeam?.(null)}
                >
                  Reset to auto
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Add Contestants */}
      <Card className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="font-display text-3xl leading-none">Add castaways</h2>
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={handleImportOfficialCast}
              variant="secondary"
              size="sm"
              disabled={isImportingCast}
            >
              <Users className="mr-2 h-4 w-4" />
              {isImportingCast ? "Importing..." : "Import official cast"}
            </Button>
            <Button
              onClick={() => setShowBulkImport(!showBulkImport)}
              variant="outline"
              size="sm"
            >
              <List className="mr-2 h-4 w-4" />
              Bulk import
            </Button>
            <Button variant="outline" size="sm" asChild>
              <label htmlFor="csv-import" className="cursor-pointer">
                <Upload className="mr-2 h-4 w-4" />
                CSV import
                <input
                  id="csv-import"
                  type="file"
                  accept=".csv"
                  onChange={handleCSVFileImport}
                  className="hidden"
                />
              </label>
            </Button>
          </div>
        </div>

        {showBulkImport ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Paste contestant data (one per line). Format: Name, Age, Location, Tribe
            </p>
            <Textarea
              placeholder="John Doe, 32, California, Ulong&#10;Jane Smith, 28, Texas, Koror"
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="min-h-[120px]"
            />
            <div className="flex gap-2">
              <Button onClick={handleBulkImport} className="flex-1">
                Import all
              </Button>
              <Button onClick={() => setShowBulkImport(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="name" className="label-caps text-muted-foreground">Name *</Label>
              <Input
                id="name"
                placeholder="Enter name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddContestant()}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="age" className="label-caps text-muted-foreground">Age</Label>
              <Input
                id="age"
                type="number"
                placeholder="Age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddContestant()}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="location" className="label-caps text-muted-foreground">Location</Label>
              <Input
                id="location"
                placeholder="City, State"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddContestant()}
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="tribe" className="label-caps text-muted-foreground">Tribe</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  id="tribe"
                  placeholder="Tribe name"
                  value={tribe}
                  onChange={(e) => setTribe(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddContestant()}
                  className="flex-1"
                />
                <Button onClick={handleAddContestant} disabled={!name.trim()} size="icon" aria-label="Add castaway">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Contestants List */}
      {contestants.length > 0 && (
        <Card className="p-4 sm:p-6 space-y-4">
          <h2 className="font-display text-3xl leading-none">
            Castaways <span className="tabular">({contestants.length})</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {contestants.map((contestant) => (
              <div
                key={contestant.id}
                className="glass rounded-[12px] p-3 min-h-[44px] flex items-center gap-3"
              >
                {editingId === contestant.id ? (
                  <div className="flex-1 space-y-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Name"
                      className="h-8"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <Input
                        value={editAge}
                        onChange={(e) => setEditAge(e.target.value)}
                        placeholder="Age"
                        type="number"
                        className="h-8 w-16"
                      />
                      <Input
                        value={editLocation}
                        onChange={(e) => setEditLocation(e.target.value)}
                        placeholder="Location"
                        className="h-8 flex-1"
                      />
                      <Input
                        value={editTribe}
                        onChange={(e) => setEditTribe(e.target.value)}
                        placeholder="Tribe"
                        className="h-8 flex-1"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => saveEdit(contestant.id)} size="sm" className="flex-1">
                        <Check className="h-4 w-4 mr-1" /> Save
                      </Button>
                      <Button onClick={cancelEdit} size="sm" variant="outline" className="flex-1">
                        <X className="h-4 w-4 mr-1" /> Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold">{contestant.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[
                          contestant.age && `${contestant.age}`,
                          contestant.location,
                          contestant.tribe,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        onClick={() => startEditing(contestant)}
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${contestant.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        onClick={() => onDeleteContestant(contestant.id)}
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete ${contestant.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Start Draft */}
      <Card className="p-6">
        <Button
          onClick={() => {
            if (filledCount < leagueSize) {
              const proceed = window.confirm(
                `Only ${filledCount} of ${leagueSize} team slots are filled. Players who haven't joined yet won't be able to draft.\n\nAre you sure you want to start?`
              );
              if (!proceed) return;
            }
            onStartDraft();
          }}
          disabled={!canStartDraft}
          variant="accent"
          className="w-full h-16 whitespace-normal text-lg font-extrabold tabular"
          size="lg"
        >
          <Play className="mr-2 h-6 w-6" />
          {poolSize >= minContestants
            ? `Start draft (${poolSize} contestants ready)`
            : poolSize < contestants.length
            ? `Start draft (${poolSize} castaways left, ${minContestants} needed: lower picks per team)`
            : `Start draft (${poolSize}/${minContestants} contestants added)`}
        </Button>
        {!canStartDraft && (
          <p className="text-center text-sm text-muted-foreground mt-3 tabular">
            Add at least {minContestants} contestants ({computedPicks} picks × {teamCount} teams) to start the draft
          </p>
        )}
      </Card>
    </div>
  );
};
