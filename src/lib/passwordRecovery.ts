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