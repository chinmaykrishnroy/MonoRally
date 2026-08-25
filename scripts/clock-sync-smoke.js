import {
  bestClockEstimate,
  computeClockMeasurement,
  validateClockProbePair
} from "../client/src/network/clock-sync.js";

const url = process.env.CLOCK_SYNC_URL || "ws://127.0.0.1:18787";
const groupCount = Math.max(4, Number(process.env.CLOCK_SYNC_GROUPS) || 12);
const maxRttMs = Math.max(1, Number(process.env.CLOCK_SYNC_MAX_RTT_MS) || 40);
const maxJitterMs = Math.max(0.5, Number(process.env.CLOCK_SYNC_MAX_JITTER_MS) || 10);
const maxUncertaintyMs = Math.max(0.5, Number(process.env.CLOCK_SYNC_MAX_UNCERTAINTY_MS) || 10);
const maxAbsoluteOffsetMs = Math.max(100, Number(process.env.CLOCK_SYNC_MAX_ABSOLUTE_OFFSET_MS) || 60000);
const pending = new Map();
const pairs = new Map();
const accepted = [];
let sequence = 0;
let invalidPairs = 0;

const socket = new WebSocket(url);
socket.addEventListener("message", handleMessage);
await waitForOpen(socket);

for (let groupId = 1; groupId <= groupCount; groupId += 1) {
  sendProbe(groupId, 0);
  await wait(40);
  sendProbe(groupId, 1);
  await wait(70);
}

const deadline = performance.now() + 3000;
while (accepted.length + invalidPairs < groupCount && performance.now() < deadline) await wait(20);
socket.close(1000, "clock test complete");

const estimate = bestClockEstimate(accepted);
const uncertaintyMs = estimate.rtt / 2 + estimate.jitter;
const acceptedMinimum = Math.max(4, Math.ceil(groupCount * 0.75));
const checks = {
  enoughPairs: accepted.length >= acceptedMinimum,
  plausibleOffset: Number.isFinite(estimate.offset) && Math.abs(estimate.offset) <= maxAbsoluteOffsetMs,
  rtt: estimate.rtt <= maxRttMs,
  jitter: estimate.jitter <= maxJitterMs,
  uncertainty: uncertaintyMs <= maxUncertaintyMs
};

console.log(JSON.stringify({
  url,
  requestedPairs: groupCount,
  acceptedPairs: accepted.length,
  rejectedPairs: invalidPairs,
  offsetMs: round(estimate.offset),
  bestRttMs: round(estimate.rtt),
  jitterMs: round(estimate.jitter),
  uncertaintyMs: round(uncertaintyMs),
  thresholds: { maxAbsoluteOffsetMs, maxRttMs, maxJitterMs, maxUncertaintyMs, acceptedMinimum },
  checks,
  passed: Object.values(checks).every(Boolean)
}, null, 2));

if (!Object.values(checks).every(Boolean)) process.exitCode = 1;

function sendProbe(groupId, groupIndex) {
  const id = ++sequence;
  const t0 = epochNow();
  pending.set(id, { groupId, groupIndex, t0 });
  socket.send(JSON.stringify({ t: "clockProbe", id, t0, groupId, groupIndex }));
}

function handleMessage(event) {
  let message;
  try {
    const text = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (message.t !== "clockProbe" || !pending.has(message.id)) return;
  const probe = pending.get(message.id);
  pending.delete(message.id);
  const measurement = computeClockMeasurement(message, epochNow());
  if (!measurement) return;
  const pair = pairs.get(probe.groupId) || [];
  pair[probe.groupIndex] = { ...measurement, ...probe };
  pairs.set(probe.groupId, pair);
  if (!pair[0] || !pair[1]) return;
  pairs.delete(probe.groupId);
  const sample = validateClockProbePair(pair[0], pair[1]);
  if (sample) accepted.push(sample);
  else invalidPairs += 1;
}

function waitForOpen(target) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Clock test could not connect to ${url}`)), 5000);
    target.addEventListener("open", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    target.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Clock test WebSocket failed for ${url}`));
    }, { once: true });
  });
}

function epochNow() {
  return performance.timeOrigin + performance.now();
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
