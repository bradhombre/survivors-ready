import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { z } from 'zod';
import { TeamAvatarUpload } from './TeamAvatarUpload';
import { CheckCircle2 } from 'lucide-react';
import { identifyUser } from '@/lib/customerio';

const inviteCodeSchema = z.object({
  code: z.string().trim().length(6, 'Invite code must be 6 characters'),
});

interface JoinLeagueDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (leagueId: string) => void;
}

export function JoinLeagueDialog({ open, onOpenChange, onSuccess }: JoinLeagueDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  
  // Step 2 state
  const [leagueId, setLeagueId] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [teamAvatarUrl, setTeamAvatarUrl] = useState<string | null>(null);
  const [originalTeamName, setOriginalTeamName] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setStep(1);
      setCode('');
      setLeagueId(null);
      setTeamId(null);
      setTeamName('');
      setTeamAvatarUrl(null);
      setOriginalTeamName('');
    }
  }, [open]);

  const handleJoinLeague = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      inviteCodeSchema.parse({ code });
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast.error(err.errors[0].message);
        return;
      }
    }

    setLoading(true);
    const { data, error } = await supabase.rpc('join_league', { invite_code_input: code.trim().toUpperCase() });

    if (error) {
      if (error.message.includes('Invalid invite code')) {
        toast.error('Invalid invite code. Please check and try again.');
      } else if (error.message.includes('Already a member')) {
        toast.error('You are already a member of this league.');
      } else if (error.message.includes('League is full')) {
        toast.error('This league is full - no available slots.');
      } else {
        toast.error(error.message || 'Failed to join league');
      }
      setLoading(false);
      return;
    }

    if (data?.league_id) {
      setLeagueId(data.league_id);
      
      // Fetch the user's team
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: teamData } = await supabase
          .from('league_teams')
          .select('id, name, avatar_url')
          .eq('league_id', data.league_id)
          .eq('user_id', user.id)
          .single();
        
        if (teamData) {
          setTeamId(teamData.id);
          setTeamName(teamData.name);
          setOriginalTeamName(teamData.name);
          setTeamAvatarUrl((teamData as any).avatar_url || null);
        }
      }
      
      setStep(2);
      toast.success('Successfully joined the league!');

      // Mark user as having an active league in Customer.io
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        identifyUser(authUser.id, authUser.email || '', authUser.created_at || '', { has_active_league: true });
      }
    }
    setLoading(false);
  };

  const handleSaveTeam = async () => {
    if (!teamId || !teamName.trim()) return;
    
    setSavingTeam(true);
    const { error } = await supabase
      .from('league_teams')
      .update({ name: teamName.trim() })
      .eq('id', teamId);

    if (error) {
      toast.error('Failed to update team name');
      setSavingTeam(false);
      return;
    }

    toast.success('Team customized!');
    setSavingTeam(false);
    onOpenChange(false);
    if (leagueId) {
      onSuccess(leagueId);
    }
  };

  const handleSkip = () => {
    onOpenChange(false);
    if (leagueId) {
      onSuccess(leagueId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {step === 1 ? (
          <>
            <DialogHeader>
              <DialogTitle>Join a league</DialogTitle>
              <DialogDescription>
                Enter the 6-character invite code your commissioner shared.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleJoinLeague} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-code" className="label-caps text-muted-foreground">Invite code</Label>
                <Input
                  id="invite-code"
                  placeholder="e.g., ABC123"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  className="h-14 text-center text-2xl font-black uppercase tracking-[0.3em] tabular"
                  autoCapitalize="characters"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={loading}>
                  {loading ? 'Joining...' : 'Join league'}
                </Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-success" />
                You're in
              </DialogTitle>
              <DialogDescription>
                You've got the "{originalTeamName}" spot. Give your team a name and a photo, or do it later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              {/* Avatar upload */}
              <div className="flex justify-center">
                {teamId && leagueId && (
                  <TeamAvatarUpload
                    teamId={teamId}
                    leagueId={leagueId}
                    currentAvatarUrl={teamAvatarUrl}
                    teamName={teamName}
                    onUploadComplete={setTeamAvatarUrl}
                    size="lg"
                  />
                )}
              </div>

              {/* Team name */}
              <div className="space-y-2">
                <Label htmlFor="team-name" className="label-caps text-muted-foreground">Team name</Label>
                <Input
                  id="team-name"
                  placeholder="e.g., The Tribal Council"
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  maxLength={50}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={handleSkip}>
                Skip for now
              </Button>
              <Button variant="accent" onClick={handleSaveTeam} disabled={savingTeam || !teamName.trim()}>
                {savingTeam ? 'Saving...' : 'Done'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
