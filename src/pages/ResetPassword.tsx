import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePasswordRecovery } from '@/hooks/usePasswordRecovery';
import { PasswordForm } from '@/components/PasswordForm';
import { Lockup } from '@/components/Lockup';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ResetPassword() {
  const status = usePasswordRecovery();
  const navigate = useNavigate();
  const changePassword = async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    toast.success('Your password has been changed.');
    navigate('/leagues', { replace: true });
  };

  return <div className="min-h-screen flex flex-col">
    <header className="bg-header">
      <div className="container max-w-md mx-auto px-4 py-5 flex items-center justify-between gap-5">
        <Link to="/" aria-label="Survivors Ready home" className="shrink-0"><Lockup className="text-2xl" /></Link>
        <span className="label-caps text-header-label text-right text-[10px] sm:text-xs tracking-[0.18em] leading-loose">Survivor fantasy league</span>
      </div>
    </header>
    <div className="buff-trim" aria-hidden="true" />
    <div className="flex flex-1 flex-col items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl">Reset your password</CardTitle>
          <CardDescription>{status === 'invalid' ? 'This reset link is invalid, expired, or has already been used. Request a new link to try again.' : 'Choose a new password for your Survivors Ready account.'}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'loading' ? <p role="status" className="text-sm text-muted-foreground">Checking your reset link…</p> : status === 'ready' ? <PasswordForm onSubmit={changePassword} /> : <Button className="w-full" asChild><Link to="/auth?forgotPassword=true">Request a new reset link</Link></Button>}
        </CardContent>
      </Card>
    </div>
  </div>;
}