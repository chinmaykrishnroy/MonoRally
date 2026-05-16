import { H, W } from "./config.js";

export const NAME_VERBS = ["swift", "steady", "sharp", "calm", "bright", "brisk", "bold", "silent", "quick", "nimble"];
export const NAME_NOUNS = ["orbit", "paddle", "rally", "vector", "pulse", "arc", "serve", "drift", "dash", "comet"];

export function cleanName(name) {
  return String(name || "player").replace(/[^\w .-]/g, "").trim().slice(0, 18) || "player";
}

export function cleanSession(sessionId) {
  return String(sessionId || "").replace(/[^\w-]/g, "").slice(0, 64);
}

export function generatedName() {
  const verb = NAME_VERBS[Math.floor(Math.random() * NAME_VERBS.length)];
  const noun = NAME_NOUNS[Math.floor(Math.random() * NAME_NOUNS.length)];
  return `${verb}-${noun}`;
}

export function playerKey(player) {
  return player.clientId || player.id;
}

export function requestedTeam(name) {
  const value = String(name || "").toLowerCase();
  if (/(^|[\s#@:[(\-])(?:a|1|team1|home|bottom|bot)(?:$|[\s\])})\-_])/.test(value)) return "bottom";
  if (/(^|[\s#@:[(\-])(?:b|2|team2|away|top)(?:$|[\s\])})\-_])/.test(value)) return "top";
  return null;
}

export function reflectX(x, radius = 0) {
  const min = radius;
  const max = W - radius;
  const span = max - min;
  if (span <= 0) return W / 2;
  let reflected = (x - min) % (span * 2);
  if (reflected < 0) reflected += span * 2;
  return min + (reflected > span ? span * 2 - reflected : reflected);
}

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function courtY(team) {
  return team === "top" ? 28 : H - 28;
}

export function startingXForSlot(slot) {
  return W * (slot % 2 === 0 ? 0.42 : 0.58);
}
