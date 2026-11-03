import { z } from 'zod';

export const newPasswordSchema = z.object({
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
  confirmPassword: z.string(),
}).refine(({ password, confirmPassword }) => password === confirmPassword, {
  message: 'Passwords must match',
  path: ['confirmPassword'],
});

export function isRecoverySessionValid(
  session: { access_token: string } | null,
  recoveryToken: string | null,
  hasUrlError: boolean,
) {
  return !hasUrlError && !!session && !!recoveryToken && session.access_token === recoveryToken;
}

/** True when the page was opened from an emailed password-reset link (implicit flow puts type=recovery in the hash). */
export function isRecoveryLink(hash: string) {
  return new URLSearchParams(hash.replace(/^#/, '')).get('type') === 'recovery';
}

/** Message for a failed "Send reset link". Supabase never errors for an unknown email, so this can't reveal who has an account. */
export function resetRequestErrorMessage(error: { status?: number; code?: string } | null) {
  if (!error) return null;
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
    return 'Please wait a minute before asking for another link.';
  }
  return "We couldn't send the reset email. Please try again.";
}

type AuthCall = Promise<{ error: { message: string; code?: string } | null }>;

/**
 * Signed-in password change. When the person types their current password, it is checked by
 * signing in with it first, so a wrong one is refused no matter how the server's own
 * "require current password" setting is configured.
 */
export async function changePasswordChecked(opts: {
  email: string | undefined;
  currentPassword?: string;
  newPassword: string;
  requireCurrent: boolean;
  signIn: (email: string, password: string) => AuthCall;
  updatePassword: (password: string, currentPassword?: string) => AuthCall;
}) {
  if (opts.requireCurrent && !opts.currentPassword) throw new Error('Enter your current password.');
  if (opts.currentPassword) {
    if (!opts.email) throw new Error("We couldn't check your current password. Sign out, sign back in, and try again.");
    const { error } = await opts.signIn(opts.email, opts.currentPassword);
    if (error) throw new Error(error.code === 'invalid_credentials' ? 'Your current password is incorrect.' : error.message);
  }
  const { error } = await opts.updatePassword(opts.newPassword, opts.currentPassword);
  if (error) throw new Error(error.message);
}
