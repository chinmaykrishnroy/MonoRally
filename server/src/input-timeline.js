import { clamp } from "./utils.js";

const TIMESTAMP_MODULO = 0x100000000;

export function epochNow() {
  return performance.timeOrigin + performance.now();
}

export function encodeTimestamp32(value = epochNow()) {
  return Math.floor(value) >>> 0;
}

export function expandTimestamp32(encoded, referenceEpoch = epochNow()) {
  const low = Number(encoded) >>> 0;
  const base = Math.floor(referenceEpoch / TIMESTAMP_MODULO) * TIMESTAMP_MODULO;
  let candidate = base + low;
  if (candidate - referenceEpoch > TIMESTAMP_MODULO / 2) candidate -= TIMESTAMP_MODULO;
  if (referenceEpoch - candidate > TIMESTAMP_MODULO / 2) candidate += TIMESTAMP_MODULO;
  return candidate;
}

export function normalizeInputTime(encoded, now, historyMs, futureToleranceMs) {
  if (!Number.isInteger(encoded) || encoded === 0) return now;
  const eventEpoch = expandTimestamp32(encoded, performance.timeOrigin + now);
  return clamp(eventEpoch - performance.timeOrigin, now - historyMs, now + futureToleranceMs);
}

export function seedInputTimeline(player, at) {
  player.inputHistory = [{ x: player.x, rawX: player.x, eventAt: at, receivedAt: at, sequence: null, vx: 0 }];
  player.lastInputEventAt = at;
}

export function recordInputSample(player, sample, options) {
  const { acceleration = Infinity, historyMs, maxSpeed, now } = options;
  player.inputHistory ??= [];

  const history = player.inputHistory;
  const previous = [...history].reverse().find((entry) => entry.eventAt <= sample.eventAt);
  const originX = previous?.x ?? player.x;
  const requestedX = Number.isFinite(sample.observedX) ? sample.observedX : sample.x;
  const elapsed = Math.max(1 / 240, (sample.eventAt - (previous?.eventAt ?? sample.eventAt - 16)) / 1000);
  const desiredVelocity = clamp((requestedX - originX) / elapsed, -maxSpeed, maxSpeed);
  const previousVelocity = Number(previous?.vx) || 0;
  let vx = moveToward(previousVelocity, desiredVelocity, acceleration * elapsed);
  let x = clamp(originX + vx * elapsed, originX - maxSpeed * elapsed, originX + maxSpeed * elapsed);
  if ((requestedX - originX) * (requestedX - x) <= 0) {
    x = requestedX;
    vx = (x - originX) / elapsed;
  }
  if (Number.isFinite(sample.observedVx)) {
    const accelerationLimit = acceleration * elapsed;
    const claimedVelocity = clamp(sample.observedVx, -maxSpeed, maxSpeed);
    vx = clamp(claimedVelocity, previousVelocity - accelerationLimit, previousVelocity + accelerationLimit);
  }
  const entry = { ...sample, observedX: requestedX, rawX: sample.x, x, vx };

  const duplicateIndex = history.findIndex((item) => item.sequence !== null && item.sequence === sample.sequence);
  if (duplicateIndex >= 0) history.splice(duplicateIndex, 1);
  history.push(entry);
  history.sort((a, b) => a.eventAt - b.eventAt || a.receivedAt - b.receivedAt);
  player.inputHistory = history.filter((item) => now - item.eventAt <= historyMs).slice(-48);

  const latest = player.inputHistory[player.inputHistory.length - 1];
  if (latest === entry || sample.eventAt >= (player.lastInputEventAt || -Infinity)) {
    player.lastInputEventAt = sample.eventAt;
  }
  return entry;
}

export function inputSampleAt(player, at) {
  const history = player.inputHistory || [];
  let result = null;
  for (const sample of history) {
    if (sample.eventAt > at) break;
    result = sample;
  }
  return result;
}

export function projectInputSample(sample, at, maxSpeed, acceleration) {
  if (!sample) return null;
  const elapsed = Math.max(0, (at - sample.eventAt) / 1000);
  if (elapsed <= 0) return { x: sample.x, vx: sample.vx || 0 };
  const target = Number.isFinite(sample.rawX) ? sample.rawX : sample.x;
  const desiredVelocity = clamp((target - sample.x) / elapsed, -maxSpeed, maxSpeed);
  const vx = moveToward(Number(sample.vx) || 0, desiredVelocity, acceleration * elapsed);
  let x = sample.x + ((Number(sample.vx) || 0) + vx) * 0.5 * elapsed;
  if ((target - sample.x) * (target - x) <= 0) x = target;
  return { x, vx };
}

function moveToward(value, target, amount) {
  if (value < target) return Math.min(target, value + amount);
  if (value > target) return Math.max(target, value - amount);
  return target;
}
