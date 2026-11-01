import { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PasswordForm } from '@/components/PasswordForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function ChangePasswordDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (open: boolean) => void; user: User | null }) {
  const changePassword = async (password: string, currentPassword?: string) => {
    const { error } = await supabase.auth.updateUser({ password, ...(currentPassword ? { current_password: currentPassword } : {}) });
    if (error) throw new Error(error.message);
    toast.success('Your password has been changed.');
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>Choose a new password for your account.</DialogDescription></DialogHeader>
      {open && <PasswordForm onSubmit={changePassword} signedIn requiresCurrentPassword={user?.identities?.some((identity) => identity.provider === 'email')} />}
    </DialogContent>
  </Dialog>;
}