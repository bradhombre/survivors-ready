// Run: npx tsx --test supabase/functions/email-sign-up/logic.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { PER_IP, clientIp, ipAllowed, normalizeEmail, pickConfirmRedirect, resendDecision, validPassword } from "./logic.ts";

describe("email-sign-up helpers", () => {
  it("normalizes emails and checks passwords like the form does", () => {
    assert.equal(normalizeEmail(" New@Example.COM "), "new@example.com");
    assert.equal(normalizeEmail("nope"), null);
    assert.equal(validPassword("12345"), false);
    assert.equal(validPassword("123456"), true);
    assert.equal(validPassword("x".repeat(73)), false);
    assert.equal(validPassword(123456), false);
  });

  it("only lands confirmation links on our site's home, My leagues or an invite link", () => {
    assert.equal(pickConfirmRedirect("https://survivorsready.com", "/join/QXUWCU"), "https://survivorsready.com/join/QXUWCU");
    assert.equal(pickConfirmRedirect("https://survivorsready.com", "/leagues"), "https://survivorsready.com/leagues");
    assert.equal(pickConfirmRedirect("https://survivorsready.com", undefined), "https://survivorsready.com/");
    assert.equal(pickConfirmRedirect("https://survivorsready.com", "//evil.example"), "https://survivorsready.com/");
    assert.equal(pickConfirmRedirect("https://survivorsready.com", "/admin"), "https://survivorsready.com/");
    assert.equal(pickConfirmRedirect("https://evil.example", "/join/ABC"), "https://survivorsready.com/join/ABC");
    assert.equal(pickConfirmRedirect("http://localhost:8080", "/"), "http://localhost:8080/");
  });

  it("limits confirmation resends to one a minute and five an hour", () => {
    const now = 1_000_000_000_000;
    assert.deepEqual(resendDecision(undefined, now), { allowed: true, next: [now] });
    assert.equal(resendDecision([now - 30_000], now).allowed, false);
    assert.equal(resendDecision([1, 2, 3, 4].map((i) => now - i * 5 * 60_000), now).allowed, true);
    assert.equal(resendDecision([1, 2, 3, 4, 5].map((i) => now - i * 5 * 60_000), now).allowed, false);
  });

  it("allows five attempts per IP per ten minutes", () => {
    const store = new Map<string, number[]>();
    const now = 1_000_000_000_000;
    for (let i = 0; i < PER_IP.max; i++) assert.equal(ipAllowed(store, "1.2.3.4", now + i), true);
    assert.equal(ipAllowed(store, "1.2.3.4", now + 10), false);
    assert.equal(ipAllowed(store, "5.6.7.8", now + 10), true);
    assert.equal(ipAllowed(store, "1.2.3.4", now + PER_IP.windowMs + 10), true);
  });

  it("reads the caller's IP from the proxy header", () => {
    assert.equal(clientIp("203.0.113.9, 10.0.0.1", null), "203.0.113.9");
    assert.equal(clientIp(null, "198.51.100.2"), "198.51.100.2");
    assert.equal(clientIp(null, null), "unknown");
  });
});
