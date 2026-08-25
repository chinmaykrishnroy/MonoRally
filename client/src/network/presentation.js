import { clamp } from "../core/shared.js";

export function presentationDelayMs({ encodedTimestamp, protocol, synced, toLocalPerformance, now = performance.now() }) {
  if (protocol < 3 || !synced || !Number.isInteger(encodedTimestamp)) return 0;
  const localAt = toLocalPerformance(encodedTimestamp);
  if (!Number.isFinite(localAt)) return 0;
  return clamp(localAt - now, 0, 500);
}
