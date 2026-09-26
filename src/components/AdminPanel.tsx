import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Shield, Trash2, UserPlus, AlertTriangle, RefreshCw, Edit, Users, Settings, Scale, Database } from 'lucide-react';
import { ScoringSettings } from './ScoringSettings';
import { SetupMode } from './SetupMode';
import { Contestant, DraftType, Player } from '@/types/survivor';
import { getPicksPerTeam } from '@/lib/picksPerTeam';

type ContestantRow = {
  id: string;
  name: string;
  tribe?: string;
  owner?: string | null;
  pick_number?: number | null;
  is_eliminated: boolean;
};

type AdminPanelProps = {
  leagueId: string;
  currentEpisode: number;
  gameType?: string;
  // Setup mode props
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
  // Data management props
  onClearScores?: () => void;
  onClearEpisodeScores?: (episode: number) => void;
  onClearHistory?: () => void;
  onResetAll?: () => void;
  onNewSeason?: () => void;
  onRevertToSetup?: () => void;
  onScoringConfigSaved?: (config: any) => void;
};

export function AdminPanel({ 
  leagueId,
  currentEpisode,
  gameType = 'full',
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
  picksPerTeam,
  onSetPicksPerTeam,
  onClearScores, 
  onClearEpisodeScores, 
  onClearHistory, 
  onResetAll, 
  onNewSeason,
  onRevertToSetup,
  onScoringConfigSaved,
}: AdminPanelProps) {
  const [selectedEpisode, setSelectedEpisode] = useState(currentEpisode);
  const [isLoading, setIsLoading] = useState(false);
  const [contestantRows, setContestantRows] = useState<ContestantRow[]>([]);
  const [editingContestant, setEditingContestant] = useState<string | null>(null);

  useEffect(() => {
    // Sitewide user management lives on the site admin page (/admin), not in a league's Admin tab
    loadContestants();
  }, []);

  const loadContestants = async () => {
    const { data: sessionData } = await supabase
      .from('game_sessions')
      .select('id')
      .eq('league_id', leagueId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!sessionData) return;

    const { data, error } = await supabase
      .from('contestants')
      .select('*')
      .eq('session_id', sessionData.id)
      .order('pick_number', { ascending: true });

    if (!error && data) {
      setContestantRows(data);
    }
  };

  const handleClearScores = () => {
    if (!confirm('Clear all scoring events for the current season? This cannot be undone.')) return;
    onClearScores?.();
    toast.success('Current season scores cleared');
  };

  const handleClearEpisodeScores = () => {
    if (!confirm(`Clear all scoring events for Episode ${selectedEpisode}? This cannot be undone.`)) return;
    onClearEpisodeScores?.(selectedEpisode);
    toast.success(`Episode ${selectedEpisode} scores cleared`);
  };

  const handleClearHistory = () => {
    if (!confirm("Delete this league's archived seasons from History? This cannot be undone.")) return;
    onClearHistory?.();
    toast.success('Season history cleared');
  };

  const handleResetAll = () => {
    if (!confirm('Reset EVERYTHING? This will clear all game data and start fresh. This cannot be undone.')) return;
    onResetAll?.();
    toast.success('All game data reset');
  };

  const handleNewSeason = () => {
    onNewSeason?.();
  };

  const updateContestantOwner = async (contestantId: string, owner: string | null) => {
    // Enforce picks_per_team limit when assigning an owner
    if (owner) {
      const teamCount = draftOrder.length || 1;
      const maxPicks = getPicksPerTeam(picksPerTeam, gameType, contestants.length, teamCount);
      const currentOwned = contestantRows.filter(c => c.owner === owner && c.id !== contestantId).length;
      if (currentOwned >= maxPicks) {
        toast.error(`${owner} already has ${currentOwned} picks (limit: ${maxPicks})`);
        return;
      }
    }

    const { error } = await supabase
      .from('contestants')
      .update({ owner })
      .eq('id', contestantId);

    if (error) {
      toast.error('Failed to update owner');
    } else {
      toast.success('Owner updated');
      loadContestants();
    }
  };

  const updateContestantPickNumber = async (contestantId: string, pickNumber: number | null) => {
    const { error } = await supabase
      .from('contestants')
      .update({ pick_number: pickNumber })
      .eq('id', contestantId);

    if (error) {
      toast.error('Failed to update pick number');
    } else {
      toast.success('Pick number updated');
      loadContestants();
    }
  };

  const deleteContestantFromDB = async (contestantId: string) => {
    if (!confirm('Are you sure you want to delete this contestant?')) return;

    const { error } = await supabase
      .from('contestants')
      .delete()
      .eq('id', contestantId);

    if (error) {
      toast.error('Failed to delete contestant');
    } else {
      toast.success('Contestant deleted');
      loadContestants();
    }
  };

  const cleanupDuplicates = async () => {
    if (!confirm('Remove duplicate contestants from the database? This will keep the best version of each contestant.')) return;
    
    setIsLoading(true);
    try {
      const { data: allContestants, error } = await supabase
        .from('contestants')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;

      const contestantsByName = new Map<string, any[]>();
      allContestants?.forEach((c) => {
        if (!contestantsByName.has(c.name)) {
          contestantsByName.set(c.name, []);
        }
        contestantsByName.get(c.name)!.push(c);
      });

      const idsToDelete: string[] = [];
      contestantsByName.forEach((contestants) => {
        if (contestants.length > 1) {
          contestants.sort((a, b) => {
            if (a.owner && !b.owner) return -1;
            if (!a.owner && b.owner) return 1;
            if (!a.is_eliminated && b.is_eliminated) return -1;
            if (a.is_eliminated && !b.is_eliminated) return 1;
            if (a.pick_number && !b.pick_number) return -1;
            if (!a.pick_number && b.pick_number) return 1;
            return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          });
          
          idsToDelete.push(...contestants.slice(1).map(c => c.id));
        }
      });

      if (idsToDelete.length > 0) {
        const { error: deleteError } = await supabase
          .from('contestants')
          .delete()
          .in('id', idsToDelete);

        if (deleteError) throw deleteError;

        toast.success(`Removed ${idsToDelete.length} duplicate contestants`);
      } else {
        toast.success('No duplicates found');
      }
    } catch (error: any) {
      console.error('Error cleaning duplicates:', error);
      toast.error('Failed to clean duplicates');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="setup" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="setup" className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            Setup
          </TabsTrigger>
          <TabsTrigger value="scoring" className="flex items-center gap-2">
            <Scale className="h-4 w-4" />
            Scoring
          </TabsTrigger>
          <TabsTrigger value="data" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Data
          </TabsTrigger>
        </TabsList>

        <TabsContent value="setup" className="mt-6">
          <SetupMode
            leagueId={leagueId}
            season={season}
            contestants={contestants}
            draftOrder={draftOrder}
            draftType={draftType}
            onSeasonChange={onSeasonChange}
            onAddContestant={onAddContestant}
            onUpdateContestant={onUpdateContestant}
            onDeleteContestant={onDeleteContestant}
            onRandomizeDraftOrder={onRandomizeDraftOrder}
            onSetDraftOrder={onSetDraftOrder}
            onDraftTypeChange={onDraftTypeChange}
            onStartDraft={onStartDraft}
            onImport={onImport}
            onExport={onExport}
            onSetContestants={onSetContestants}
            picksPerTeam={picksPerTeam}
            onSetPicksPerTeam={onSetPicksPerTeam}
          />
        </TabsContent>

        <TabsContent value="scoring" className="mt-6">
          <div className="container max-w-4xl mx-auto">
            {gameType === 'winner_takes_all' ? (
              <div className="relative">
                <div className="opacity-40 pointer-events-none">
                  <ScoringSettings leagueId={leagueId} onScoringConfigSaved={onScoringConfigSaved} />
                </div>
                <div className="absolute inset-0 flex items-center justify-center px-4">
                  <Card className="p-6 text-center max-w-md">
                    <Scale className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                    <h3 className="font-display text-2xl leading-none mb-3">Scoring not applicable</h3>
                    <p className="text-sm text-muted-foreground">
                      Custom scoring rules don't apply to Winner Takes All leagues. Switch to Full Fantasy to use custom scoring.
                    </p>
                  </Card>
                </div>
              </div>
            ) : (
              <ScoringSettings leagueId={leagueId} onScoringConfigSaved={onScoringConfigSaved} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="data" className="mt-6">
          <div className="container max-w-4xl mx-auto space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  Contestant management
                </CardTitle>
                <CardDescription>
                  Fix contestant assignments, owners, and pick numbers
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto divide-y divide-border">
                  {contestantRows.map((contestant) => (
                    <div
                      key={contestant.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3 min-h-[44px]"
                    >
                      <div className="flex-1 min-w-0">
                        <div className={`font-bold ${contestant.is_eliminated ? 'line-through text-muted-foreground' : ''}`}>
                          {contestant.name}
                        </div>
                        <div className="text-sm text-muted-foreground tabular">
                          {contestant.tribe && `${contestant.tribe} · `}
                          Pick #{contestant.pick_number || 'Undrafted'}
                          {contestant.is_eliminated && ' · Eliminated'}
                        </div>
                      </div>

                      {editingContestant === contestant.id ? (
                        <div className="flex gap-2 items-center">
                          <Select
                            value={contestant.owner || 'none'}
                            onValueChange={(value) =>
                              updateContestantOwner(contestant.id, value === 'none' ? null : value)
                            }
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">None</SelectItem>
                              {draftOrder.map((player) => (
                                <SelectItem key={String(player)} value={String(player)}>
                                  {String(player)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Input
                            type="number"
                            min="1"
                            max="20"
                            placeholder="Pick #"
                            value={contestant.pick_number || ''}
                            onChange={(e) =>
                              updateContestantPickNumber(
                                contestant.id,
                                e.target.value ? parseInt(e.target.value) : null
                              )
                            }
                            className="h-10 w-20 tabular"
                          />

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingContestant(null)}
                          >
                            Done
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2 items-center">
                          <Badge variant={contestant.owner ? 'default' : 'secondary'}>
                            {contestant.owner || 'Undrafted'}
                          </Badge>
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`Edit ${contestant.name}`}
                            onClick={() => setEditingContestant(contestant.id)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Delete ${contestant.name}`}
                            onClick={() => deleteContestantFromDB(contestant.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  Members and co-commissioners
                </CardTitle>
                <CardDescription>
                  Invite people, make someone a co-commissioner, or remove a member on the League tab. Only people in this league show up there.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-muted-foreground" />
                  Season management
                </CardTitle>
                <CardDescription>
                  Archive current season and start a new one
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="default"
                  className="w-full justify-start"
                  onClick={handleNewSeason}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Start new season (archive current)
                </Button>
              </CardContent>
            </Card>

            {/* Danger zone: destructive actions */}
            <Card className="border-accent">
              <CardHeader>
                <p className="label-caps flex items-center gap-1.5 text-destructive">
                  <AlertTriangle className="h-4 w-4" />
                  Danger zone
                </p>
                <CardTitle className="text-3xl">Game data</CardTitle>
                <CardDescription>
                  Clear game data. These actions cannot be undone.
                </CardDescription>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                <div className="space-y-3 pb-5">
                  <div>
                    <p className="label-caps text-muted-foreground">Draft</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Revert the draft back to setup mode if needed
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => {
                      const first = confirm("REVERT TO SETUP?\n\nThis will clear ALL draft picks and let you re-draft. Are you sure?");
                      if (!first) return;
                      const second = confirm("FINAL CONFIRMATION\n\nAll contestant assignments will be removed. This cannot be undone.\n\nClick OK to revert.");
                      if (second) onRevertToSetup?.();
                    }}
                    disabled={!contestants.some(c => c.owner)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Revert draft to setup
                  </Button>
                </div>

                <div className="space-y-3 py-5">
                  <p className="label-caps text-muted-foreground">Scores and history</p>
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={cleanupDuplicates}
                    disabled={isLoading}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Clean up duplicate contestants
                  </Button>

                  <div className="space-y-2">
                    <Label htmlFor="episode-select" className="label-caps text-muted-foreground">
                      Clear specific episode
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="episode-select"
                        type="number"
                        min="1"
                        value={selectedEpisode}
                        onChange={(e) => setSelectedEpisode(parseInt(e.target.value) || 1)}
                        className="w-24 tabular"
                      />
                      <Button
                        variant="outline"
                        onClick={handleClearEpisodeScores}
                        className="flex-1"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Clear episode <span className="tabular">{selectedEpisode}</span>
                      </Button>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleClearScores}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear all season scores
                  </Button>

                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={handleClearHistory}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Clear season history
                  </Button>
                </div>

                <div className="pt-5">
                  <Button
                    variant="destructive"
                    className="w-full justify-start"
                    onClick={handleResetAll}
                  >
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Reset all game data
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
