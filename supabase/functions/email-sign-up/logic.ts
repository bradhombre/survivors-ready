// Pure helpers for email-sign-up (no Deno or network calls, so they can be unit tested).

/** Resend limits per account (same as password reset). */
export const RESEND = { minGapMs: 60_000, windowMs: 60 * 60_000, maxPerWindow: 5 };
/** Sign-up attempts per IP address, per server instance (best effort). */
export const PER_IP = { windowMs: 10 * 60_000, max: 5 };
/** Above this many new accounts in an hour, hand sign-ups to the login system's own limits. */
export const HOURLY_SIGNUP_CEILING = 40;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Same rule as the sign-up form (6+ characters); 72 is the most the password hash uses. */
export function validPassword(raw: unknown): raw is string {
  return typeof raw === "string" && raw.length >= 6 && raw.length <= 72;
}

/** Where the confirmation link lands: our own site only, and only the home page, My leagues or an invite link. */
export function pickConfirmRedirect(origin: string | null, path: unknown): string {
  const base = origin && (/^https:\/\/([a-z0-9-]+\.)?survivorsready\.com$/i.test(origin) || /^http:\/\/localhost(:\d+)?$/i.test(origin))
    ? origin
    : "https://survivorsready.com";
  const safePath = typeof path === "string" && /^\/(leagues|join\/[A-Za-z0-9_-]{1,40})?$/.test(path) ? path : "/";
  return `${base}${safePath}`;
}

/** Keep recent times (ms) inside the window; drop junk and future values. */
function recent(times: unknown, now: number, windowMs: number): number[] {
  return (Array.isArray(times) ? times : [])
    .filter((t): t is number => typeof t === "number" && Number.isFinite(t))
    .filter((t) => t <= now && now - t < windowMs);
}

/** May this account get another confirmation email now? Returns the list to store if we send. */
export function resendDecision(sends: unknown, now: number): { allowed: boolean; next: number[] } {
  const kept = recent(sends, now, RESEND.windowMs);
  const last = kept.length ? Math.max(...kept) : null;
  const allowed = kept.length < RESEND.maxPerWindow && (last === null || now - last >= RESEND.minGapMs);
  return { allowed, next: allowed ? [...kept, now] : kept };
}

/** Best-effort per-IP limiter (memory of one server instance). Mutates `store`. */
export function ipAllowed(store: Map<string, number[]>, ip: string, now: number): boolean {
  const kept = recent(store.get(ip), now, PER_IP.windowMs);
  if (kept.length >= PER_IP.max) {
    store.set(ip, kept);
    return false;
  }
  store.set(ip, [...kept, now]);
  if (store.size > 5000) store.clear(); // never grow without bound
  return true;
}

/** First address in X-Forwarded-For (the caller), or "unknown". */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const first = (forwardedFor ?? "").split(",")[0].trim();
  return first || (realIp ?? "").trim() || "unknown";
}

/** Escape LIKE wildcards so an email is matched literally (case-insensitive) with ilike. */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
