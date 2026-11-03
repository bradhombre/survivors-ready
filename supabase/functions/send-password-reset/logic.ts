// Pure helpers for send-password-reset (no Deno or network calls, so they can be unit tested).

export const DEFAULT_REDIRECT = "https://survivorsready.com/reset-password";

/** How often one account can be sent a reset email. */
export const THROTTLE = { minGapMs: 60_000, windowMs: 60 * 60_000, maxPerWindow: 5 };

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Reset links only ever point back to our own site (or a local dev server). */
export function pickRedirect(origin: string | null): string {
  if (origin && (/^https:\/\/([a-z0-9-]+\.)?survivorsready\.com$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/i.test(origin))) {
    return `${origin}/reset-password`;
  }
  return DEFAULT_REDIRECT;
}

/**
 * Decide whether this account can get another reset email now.
 * `sends` are earlier send times (ms) kept on the account; returns the list to store if we send.
 */
export function throttleDecision(sends: unknown, now: number): { allowed: boolean; next: number[] } {
  const recent = (Array.isArray(sends) ? sends : [])
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t))
    .filter((t) => now - t < THROTTLE.windowMs && t <= now);
  const last = recent.length ? Math.max(...recent) : null;
  const allowed = recent.length < THROTTLE.maxPerWindow && (last === null || now - last >= THROTTLE.minGapMs);
  return { allowed, next: allowed ? [...recent, now] : recent };
}

/** Escape LIKE wildcards so an email is matched literally (case-insensitive) with ilike. */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
