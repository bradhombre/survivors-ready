// Customer.io tracking utility
// Thin wrapper around the global _cio object

declare global {
  interface Window {
    _cio: {
      identify: (data: Record<string, unknown>) => void;
      track: (name: string, data?: Record<string, unknown>) => void;
    };
  }
}

function getCio() {
  return typeof window !== 'undefined' && window._cio ? window._cio : null;
}

export function identifyUser(
  id: string,
  email: string,
  createdAt: string,
  extras?: Record<string, unknown>
) {
  const cio = getCio();
  if (!cio) return;
  cio.identify({
    id,
    email,
    created_at: Math.floor(new Date(createdAt).getTime() / 1000),
    last_active_at: Math.floor(Date.now() / 1000),
    ...extras,
  });
}

export function trackEvent(name: string, properties?: Record<string, unknown>) {
  const cio = getCio();
  if (!cio) return;
  cio.track(name, properties);
}

export function updateLastActive(id: string) {
  const cio = getCio();
  if (!cio) return;
  cio.identify({
    id,
    last_active_at: Math.floor(Date.now() / 1000),
  });
}

/** Set profile attributes on the signed-in person (used to target in-app messages). */
export function setAttributes(id: string, attributes: Record<string, unknown>) {
  const cio = getCio();
  if (!cio) return;
  cio.identify({ id, ...attributes });
}
