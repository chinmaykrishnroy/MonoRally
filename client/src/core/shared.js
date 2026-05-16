export const W = 1000;
export const H = 680;

export const config = {
  aiDifficulty: "hard",
  renderDelayMs: 90,
  quickMatchFallbackMs: 5000,
  quickAiDifficulty: "medium",
  maxSpectators: 10,
  maxBalls: 10,
  multiballTotal1v1: 2,
  multiballTotal2v2: 4,
  powerupEffectMs: 5000,
  missLimit1v1: 5,
  missLimit2v2: 8,
  colorInvertAtSeconds: 100,
  colorInvertDurationMs: 3000,
  networkHz: 30,
  physicsHz: 60
};

export const settings = {
  bottomHalfControl: true,
  sound: true
};

export const SETTINGS_KEY = "monorally-settings-v1";
export const SESSION_KEY = "monorally_session";
export const RESUME_KEY = "monorally-resume-v1";

export const HANDLE_VERBS = ["swift", "steady", "sharp", "calm", "bright", "brisk", "bold", "silent", "quick", "nimble"];
export const HANDLE_NOUNS = ["orbit", "paddle", "rally", "vector", "pulse", "arc", "serve", "drift", "dash", "comet"];

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
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

export function generatedHandle() {
  const verb = HANDLE_VERBS[Math.floor(Math.random() * HANDLE_VERBS.length)];
  const noun = HANDLE_NOUNS[Math.floor(Math.random() * HANDLE_NOUNS.length)];
  return `${verb}-${noun}`;
}
