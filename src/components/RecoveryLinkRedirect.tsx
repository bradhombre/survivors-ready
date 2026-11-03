import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { arrivedWithRecoveryLink } from '@/hooks/usePasswordRecovery';

/**
 * A reset link should open /reset-password. If it opens any other page (for example the home page,
 * when the auth redirect allow-list doesn't include /reset-password), send it there once, before
 * the home page can forward the now signed-in person to My leagues without letting them set a password.
 */
export function RecoveryLinkRedirect() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || !arrivedWithRecoveryLink) return;
    handled.current = true;
    if (pathname !== '/reset-password') navigate('/reset-password', { replace: true });
  }, [navigate, pathname]);
  return null;
}
