// Run: npx tsx --test supabase/functions/send-password-reset/logic.test.ts
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { DEFAULT_REDIRECT, THROTTLE, likeLiteral, normalizeEmail, pickRedirect, throttleDecision } from "./logic.ts";

describe("send-password-reset helpers", () => {
  it("normalizes and validates emails", () => {
    assert.equal(normalizeEmail("  Brad@SurvivorsReady.com "), "brad@survivorsready.com");
    assert.equal(normalizeEmail("not-an-email"), null);
    assert.equal(normalizeEmail(""), null);
    assert.equal(normalizeEmail(42), null);
    assert.equal(normalizeEmail(`${"a".repeat(250)}@b.co`), null);
  });

  it("only sends reset links back to our own site", () => {
    assert.equal(pickRedirect("https://survivorsready.com"), "https://survivorsready.com/reset-password");
    assert.equal(pickRedirect("https://www.survivorsready.com"), "https://www.survivorsready.com/reset-password");
    assert.equal(pickRedirect("http://localhost:8080"), "http://localhost:8080/reset-password");
    assert.equal(pickRedirect("https://evil.example"), DEFAULT_REDIRECT);
    assert.equal(pickRedirect("https://survivorsready.com.evil.example"), DEFAULT_REDIRECT);
    assert.equal(pickRedirect(null), DEFAULT_REDIRECT);
  });

  it("allows a first send and records it", () => {
    const now = 1_000_000_000_000;
    assert.deepEqual(throttleDecision(undefined, now), { allowed: true, next: [now] });
  });

  it("blocks a second send within a minute", () => {
    const now = 1_000_000_000_000;
    const r = throttleDecision([now - 30_000], now);
    assert.equal(r.allowed, false);
    assert.deepEqual(r.next, [now - 30_000]);
  });

  it("allows another after a minute, up to five an hour", () => {
    const now = 1_000_000_000_000;
    const four = [1, 2, 3, 4].map((i) => now - i * 5 * 60_000);
    assert.equal(throttleDecision(four, now).allowed, true);
    const five = [1, 2, 3, 4, 5].map((i) => now - i * 5 * 60_000);
    assert.equal(throttleDecision(five, now).allowed, false);
  });

  it("forgets sends older than an hour and ignores junk", () => {
    const now = 1_000_000_000_000;
    const old = [now - THROTTLE.windowMs - 1, "x", null, now + 10_000];
    assert.deepEqual(throttleDecision(old, now), { allowed: true, next: [now] });
  });

  it("matches emails literally in a LIKE pattern", () => {
    assert.equal(likeLiteral("a_b%c@d.com"), "a\\_b\\%c@d.com");
  });
});
