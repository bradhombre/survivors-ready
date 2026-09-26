import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Lockup } from '@/components/Lockup';

export default function JoinByLink() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const processJoin = async () => {
      if (!code) {
        toast.error('Invalid invite link');
        navigate('/leagues');
        return;
      }

      // Check if user is logged in
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        // Redirect to auth with return URL
        navigate(`/auth?returnTo=/join/${code}`);
        return;
      }

      // User is logged in, attempt to join
      try {
        const { data, error } = await supabase.rpc('join_league', {
          invite_code_input: code.toUpperCase()
        });

        if (error) {
          if (error.message.includes('Already a member')) {
            toast.info('You are already a member of this league');
            // Find the league and redirect to it
            const { data: leagues } = await supabase
              .from('leagues')
              .select('id')
              .eq('invite_code', code.toUpperCase())
              .maybeSingle();
            
            if (leagues?.id) {
              navigate(`/league/${leagues.id}`);
            } else {
              navigate('/leagues');
            }
          } else if (error.message.includes('Invalid invite code')) {
            toast.error('Invalid invite code');
            navigate('/leagues');
          } else if (error.message.includes('League is full')) {
            toast.error('This league is full - no available slots');
            navigate('/leagues');
          } else {
            toast.error(error.message);
            navigate('/leagues');
          }
        } else if (data) {
          // Successfully joined - auto-assigned to team slot
          toast.success('Successfully joined the league!');
          navigate(`/league/${data.league_id}`);
        }
      } catch (err) {
        toast.error('Failed to join league');
        navigate('/leagues');
      } finally {
        setIsProcessing(false);
      }
    };

    processJoin();
  }, [code, navigate]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-header">
        <div className="container max-w-md mx-auto px-4 py-5">
          <Lockup className="text-xl sm:text-2xl" />
        </div>
      </header>
      <div className="buff-trim" aria-hidden="true" />
      <main className="flex-1 flex items-center justify-center px-4 py-16">
        {isProcessing && (
          <div className="plank px-8 py-8 flex flex-col items-center gap-4 text-center" role="status">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <p className="font-display text-3xl leading-none">Heading to camp…</p>
            <p className="text-sm text-muted-foreground">Joining the league</p>
          </div>
        )}
      </main>
    </div>
  );
}
