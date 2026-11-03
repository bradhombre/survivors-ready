import { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { PasswordForm } from '@/components/PasswordForm';
import { changePasswordChecked } from '@/lib/passwordRecovery';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function ChangePasswordDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (open: boolean) => void; user: User | null }) {
  // Email-and-password accounts must confirm their current password. Google-only accounts may not have one.
  const requiresCurrentPassword = !!user?.identities?.some((identity) => identity.provider === 'email');
  const changePassword = async (password: string, currentPassword?: string) => {
    await changePasswordChecked({
      email: user?.email,
      currentPassword,
      newPassword: password,
      requireCurrent: requiresCurrentPassword,
      signIn: (email, current) => supabase.auth.signInWithPassword({ email, password: current }),
      updatePassword: (next, current) => supabase.auth.updateUser({ password: next, ...(current ? { current_password: current } : {}) }),
    });
    toast.success('Your password has been changed.');
    onOpenChange(false);
  };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader><DialogTitle>Change password</DialogTitle><DialogDescription>Choose a new password for your account.</DialogDescription></DialogHeader>
      {open && <PasswordForm onSubmit={changePassword} signedIn requiresCurrentPassword={requiresCurrentPassword} />}
    </DialogContent>
  </Dialog>;
}
