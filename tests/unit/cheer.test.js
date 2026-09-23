import { describe, expect, test } from "vitest";
import { ALLOWED_CHEERS, CHEER_COOLDOWN_MS, validateCheer } from "../../server/src/cheer.js";

describe("spectator cheer reactions", () => {
  test("allows all defined cheer emojis", () => {
    for (const emoji of ALLOWED_CHEERS) {
      const res = validateCheer(emoji, 0, 10000);
      expect(res.ok).toBe(true);
    }
  });

  test("rejects unauthorized emojis or arbitrary text", () => {
    expect(validateCheer("💩", 0, 10000).ok).toBe(false);
    expect(validateCheer("gg", 0, 10000).ok).toBe(false);
    expect(validateCheer("", 0, 10000).ok).toBe(false);
  });

  test("rate limits cheers within cooldown period", () => {
    const t0 = 10000;
    const first = validateCheer("🔥", 0, t0);
    expect(first.ok).toBe(true);

    // Too soon (under cooldown)
    const tooSoon = validateCheer("🔥", t0, t0 + CHEER_COOLDOWN_MS - 100);
    expect(tooSoon.ok).toBe(false);
    expect(tooSoon.reason).toBe("rate_limited");

    // After cooldown
    const afterCooldown = validateCheer("🔥", t0, t0 + CHEER_COOLDOWN_MS + 10);
    expect(afterCooldown.ok).toBe(true);
  });
});
