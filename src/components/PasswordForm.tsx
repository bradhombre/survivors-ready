import { useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { newPasswordSchema } from '@/lib/passwordRecovery';

interface PasswordFormProps {
  onSubmit: (password: string, currentPassword?: string) => Promise<void>;
  signedIn?: boolean;
  requiresCurrentPassword?: boolean;
}

export function PasswordForm({ onSubmit, signedIn = false, requiresCurrentPassword = false }: PasswordFormProps) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsLoading(true);
    try {
      newPasswordSchema.parse({ password, confirmPassword });
      await onSubmit(password, currentPassword || undefined);
    } catch (error) {
      toast.error(error instanceof z.ZodError ? error.errors[0].message : error instanceof Error ? error.message : 'Unable to change your password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {signedIn && <div className="space-y-2">
        <Label htmlFor="current-password">Current password{!requiresCurrentPassword && ' (if you have one)'}</Label>
        <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required={requiresCurrentPassword} />
      </div>}
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <Input id="new-password" type="password" autoComplete="new-password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <Input id="confirm-password" type="password" autoComplete="new-password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={6} />
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>{isLoading ? 'Saving…' : 'Change password'}</Button>
    </form>
  );
}