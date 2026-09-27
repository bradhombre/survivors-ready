import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useIsSuperAdmin } from '@/hooks/useIsSuperAdmin';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Users, LogOut, Crown, Shield, User, Settings, Trophy, Target, Trash2, MoreVertical } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CreateLeagueDialog } from '@/components/CreateLeagueDialog';
import { JoinLeagueDialog } from '@/components/JoinLeagueDialog';

import { toast } from 'sonner';
import { Lockup } from "@/components/Lockup";
import { useAppSettings } from '@/hooks/useAppSettings';
import { setAttributes } from '@/lib/customerio';

interface LeagueMembership {
  id: string;
  role: string;
  leagues: {
    id: string;
    name: string;
    invite_code: string;
    owner_id: string;
  } | null;
}

export default function Leagues() {
  const [memberships, setMemberships] = useState<LeagueMembership[]>([]);
  const [gameTypes, setGameTypes] = useState<Record<string, string>>({});
  const [leagueSeasons, setLeagueSeasons] = useState<Record<string, number>>({});
  const { settings: appSettings, loading: settingsLoading } = useAppSettings();
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteLeagueOpen, setDeleteLeagueOpen] = useState(false);
  const [leagueToDelete, setLeagueToDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingLeague, setDeletingLeague] = useState(false);
  const { user, signOut, loading: authLoading } = useAuth();
  const { isSuperAdmin } = useIsSuperAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    // Wait for auth to finish loading before making decisions
    if (authLoading) return;
    
    if (!user) {
      navigate('/auth');
      return;
    }
    fetchMemberships();
  }, [user, authLoading, navigate]);

  const fetchMemberships = async () => {
    if (!user) return;
    
    setLoading(true);
    const { data, error } = await supabase
      .from('league_memberships')
      .select(`
        id,
        role,
        leagues (
          id,
          name,
          invite_code,
          owner_id
        )
      `)
      .eq('user_id', user.id)
      .not('league_id', 'is', null);

    if (error) {
      toast.error('Failed to load leagues');
      console.error(error);
    } else {
      setMemberships((data as LeagueMembership[]) || []);
      
      // Fetch game types for each league
      const leagueIds = (data as LeagueMembership[])
        .filter(m => m.leagues)
        .map(m => m.leagues!.id);
      
      if (leagueIds.length > 0) {
        const { data: sessions } = await supabase
          .from('game_sessions')
          .select('league_id, game_type, season')
          .in('league_id', leagueIds)
          .order('created_at', { ascending: false });
        
        if (sessions) {
          const typeMap: Record<string, string> = {};
          const seasonMap: Record<string, number> = {};
          sessions.forEach((s: any) => {
            if (s.league_id && !typeMap[s.league_id]) {
              typeMap[s.league_id] = s.game_type || 'full';
              if (typeof s.season === 'number') seasonMap[s.league_id] = s.season;
            }
          });
          setGameTypes(typeMap);
          setLeagueSeasons(seasonMap);
        }
      }
    }
    setLoading(false);
  };

  // Tell Customer.io where this person's leagues stand, so in-app messages can
  // target commissioners whose league is still on last season (and nobody else).
  useEffect(() => {
    if (!user || loading || settingsLoading) return;
    const current = parseInt((appSettings.current_season || '').match(/\d{1,4}/)?.[0] || '', 10);
    if (!current) return;
    const withSeason = memberships.filter((m) => m.leagues && leagueSeasons[m.leagues.id] != null);
    const isCommissioner = (m: LeagueMembership) =>
      m.role === 'league_admin' || m.leagues?.owner_id === user.id;
    const oldCommissioner = withSeason
      .filter((m) => isCommissioner(m) && leagueSeasons[m.leagues!.id] < current)
      .sort((a, b) => leagueSeasons[b.leagues!.id] - leagueSeasons[a.leagues!.id]);
    const onCurrent = withSeason.some((m) => leagueSeasons[m.leagues!.id] >= current);
    setAttributes(user.id, {
      current_season: current,
      league_count: withSeason.length,
      has_current_season_league: onCurrent,
      needs_new_season: oldCommissioner.length > 0 && !onCurrent,
      old_season_league_id: oldCommissioner[0]?.leagues?.id ?? '',
      old_season_number: oldCommissioner[0] ? leagueSeasons[oldCommissioner[0].leagues!.id] : '',
    });
  }, [user, loading, settingsLoading, appSettings, memberships, leagueSeasons]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  const handleDeleteLeague = async () => {
    if (!leagueToDelete) return;
    setDeletingLeague(true);
    try {
      const { error } = await supabase.rpc('delete_league', { league_uuid: leagueToDelete.id });
      if (error) throw error;
      toast.success(`"${leagueToDelete.name}" has been deleted.`);
      fetchMemberships();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete league');
    } finally {
      setDeletingLeague(false);
      setDeleteLeagueOpen(false);
      setLeagueToDelete(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-my-account`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Failed to delete account');
      await signOut();
      navigate('/auth');
      toast.success('Your account has been deleted.');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete account');
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'super_admin':
      case 'league_admin':
        return <Crown className="h-3 w-3" />;
      case 'moderator':
        return <Shield className="h-3 w-3" />;
      default:
        return <User className="h-3 w-3" />;
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin':
        return 'Site owner';
      case 'league_admin':
        return 'Commissioner';
      case 'moderator':
        return 'Moderator';
      case 'player':
        return 'Player';
      default:
        return role;
    }
  };

  const getRoleVariant = (role: string): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (role) {
      case 'super_admin':
      case 'league_admin':
        return 'default';
      case 'moderator':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="label-caps text-muted-foreground" role="status">Loading your leagues…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-header">
        <div className="container max-w-5xl mx-auto px-4 pt-4 pb-5 flex justify-between items-start gap-3">
          <div className="flex flex-col gap-2 min-w-0">
            <Lockup className="text-2xl sm:text-3xl" />
            <h1 className="label-caps text-header-label">My leagues</h1>
          </div>
          <div className="flex gap-2">
            {isSuperAdmin && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/admin">
                  <Settings className="h-4 w-4 mr-2" />
                  Admin
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete account
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
      <div className="buff-trim" aria-hidden="true" />

      <main className="container max-w-5xl mx-auto px-4 py-8">
        <div className="flex gap-3 mb-8">
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Start a league
          </Button>
          <Button variant="outline" onClick={() => setJoinOpen(true)}>
            <Users className="h-4 w-4 mr-2" />
            Join a league
          </Button>
        </div>

        {memberships.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
            <div className="text-center mb-10">
              <h2 className="font-display text-4xl leading-none text-primary mb-3">Welcome to camp</h2>
              <p className="text-muted-foreground text-lg max-w-md mx-auto">
                Draft contestants, earn points, and compete with friends to see who has the best Survivor instincts.
              </p>
            </div>
            
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 max-w-2xl w-full">
              <Card 
                className="cursor-pointer transition-colors hover:bg-muted group"
                onClick={() => setCreateOpen(true)}
              >
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                    <Crown className="h-7 w-7 text-primary" />
                  </div>
                  <CardTitle className="text-2xl">Start a league</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-muted-foreground text-sm mb-4">
                    Start your own fantasy league and invite friends. You'll be the league admin with full control over settings and gameplay.
                  </p>
                  <Button className="w-full">
                    <Plus className="h-4 w-4 mr-2" />
                    Start a league
                  </Button>
                </CardContent>
              </Card>

              <Card 
                className="cursor-pointer transition-colors hover:bg-muted group"
                onClick={() => setJoinOpen(true)}
              >
                <CardHeader className="text-center pb-2">
                  <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-secondary/50 flex items-center justify-center group-hover:bg-secondary transition-colors">
                    <Users className="h-7 w-7 text-secondary-foreground" />
                  </div>
                  <CardTitle className="text-2xl">Join a league</CardTitle>
                </CardHeader>
                <CardContent className="text-center">
                  <p className="text-muted-foreground text-sm mb-4">
                    Have an invite code? Join an existing league and start competing with your group right away.
                  </p>
                  <Button variant="outline" className="w-full">
                    <Users className="h-4 w-4 mr-2" />
                    Join a league
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {memberships.map((membership) => (
              membership.leagues && (
                <Card 
                  key={membership.id}
                  className="cursor-pointer transition-colors hover:bg-muted"
                  onClick={() => navigate(`/league/${membership.leagues!.id}`)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="text-2xl leading-[0.95] break-words min-w-0">{membership.leagues.name}</CardTitle>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-col items-end gap-1">
                          <Badge variant={getRoleVariant(membership.role)} className="flex items-center gap-1">
                            {getRoleIcon(membership.role)}
                            {getRoleLabel(membership.role)}
                          </Badge>
                          <Badge variant="outline" className="text-xs flex items-center gap-1">
                            {gameTypes[membership.leagues.id] === 'winner_takes_all' ? (
                              <><Target className="h-3 w-3" />WTA</>
                            ) : (
                              <><Trophy className="h-3 w-3" />Fantasy</>
                            )}
                          </Badge>
                        </div>
                        {user && membership.leagues.owner_id === user.id && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-10 w-10 shrink-0"
                                aria-label={`Options for ${membership.leagues.name}`}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => {
                                  setLeagueToDelete({ id: membership.leagues!.id, name: membership.leagues!.name });
                                  setDeleteLeagueOpen(true);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete league
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {(membership.role === 'league_admin' || membership.role === 'super_admin') && (
                      <p className="text-xs text-muted-foreground">
                        Invite code <span className="font-extrabold tracking-[0.15em] text-foreground tabular">{membership.leagues.invite_code}</span>
                      </p>
                    )}
                  </CardContent>
                </Card>
              )
            ))}
          </div>
        )}
      </main>

      <AlertDialog open={deleteLeagueOpen} onOpenChange={setDeleteLeagueOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{leagueToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this league, all its game data, teams, and chat history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingLeague}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteLeague}
              disabled={deletingLeague}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingLeague ? 'Deleting...' : 'Delete league'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateLeagueDialog 
        open={createOpen} 
        onOpenChange={setCreateOpen}
        onSuccess={(leagueId) => navigate(`/league/${leagueId}`)}
      />
      <JoinLeagueDialog 
        open={joinOpen} 
        onOpenChange={setJoinOpen}
        onSuccess={(leagueId) => navigate(`/league/${leagueId}`)}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account and remove you from all leagues. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting...' : 'Delete My Account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
