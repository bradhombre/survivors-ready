import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isRecoveryLink, isRecoverySessionValid } from '@/lib/passwordRecovery';

// Capture the link before Auth consumes and clears its hash, and register early
// so PASSWORD_RECOVERY cannot be missed while the route mounts.
const incomingHash = new URLSearchParams(window.location.hash.slice(1));
const incomingQuery = new URLSearchParams(window.location.search);
const hasUrlError = incomingHash.has('error') || incomingHash.has('error_code') || incomingQuery.has('error') || incomingQuery.has('error_code');
// Set once at page load. If the link lands on another page (e.g. the redirect allow-list sent it home), App sends it to /reset-password.
export const arrivedWithRecoveryLink = isRecoveryLink(window.location.hash);
let recoveryToken = arrivedWithRecoveryLink ? incomingHash.get('access_token') : null;
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') recoveryToken = session?.access_token ?? null;
  if (event === 'TOKEN_REFRESHED' && recoveryToken) recoveryToken = session?.access_token ?? null;
  if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') recoveryToken = null;
});

export function usePasswordRecovery() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'invalid'>('loading');

  useEffect(() => {
    let active = true;
    let validationVersion = 0;
    const validate = async () => {
      const version = ++validationVersion;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!isRecoverySessionValid(session, recoveryToken, hasUrlError)) {
          if (active && version === validationVersion) setStatus('invalid');
          return;
        }
        const { data, error } = await supabase.auth.getUser();
        if (active && version === validationVersion) setStatus(!error && data.user ? 'ready' : 'invalid');
      } catch {
        if (active && version === validationVersion) setStatus('invalid');
      }
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        setTimeout(() => { if (active) void validate(); }, 0);
      }
    });
    void validate();
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  return status;
}