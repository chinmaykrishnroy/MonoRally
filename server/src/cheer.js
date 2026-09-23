export const ALLOWED_CHEERS = ["👏", "🔥", "⚡", "🚀", "🎯"];
export const CHEER_COOLDOWN_MS = 1500;

/**
 * Validates a cheer request from a spectator.
 * @param {string} emoji
 * @param {number} lastCheerAt
 * @param {number} now
 * @returns {{ ok: boolean, reason?: string }}
 */
export function validateCheer(emoji, lastCheerAt = 0, now = performance.now()) {
  if (!emoji || !ALLOWED_CHEERS.includes(emoji)) {
    return { ok: false, reason: "invalid_emoji" };
  }
  if (now - (lastCheerAt || 0) < CHEER_COOLDOWN_MS) {
    return { ok: false, reason: "rate_limited" };
  }
  return { ok: true };
}
