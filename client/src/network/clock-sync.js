const TIMESTAMP_MODULO = 0x100000000;
const PROBE_GAP_MS = 40;
const PROBE_GAP_TOLERANCE_MS = 12;

export function epochNow() {
  return performance.timeOrigin + performance.now();
}

export function computeClockMeasurement(message, receivedAt = epochNow()) {
  const t0 = Number(message.t0);
  const t1 = Number(message.t1);
  const t2 = Number(message.t2);
  if (![t0, t1, t2, receivedAt].every(Number.isFinite)) return null;
  const rtt = Math.max(0, receivedAt - t0 - Math.max(0, t2 - t1));
  const offset = (t1 - t0 + (t2 - receivedAt)) / 2;
  if (rtt > 2000 || Math.abs(offset) > 60000) return null;
  return { t0, t1, t2, t3: receivedAt, rtt, offset, at: receivedAt };
}

export function bestClockEstimate(measurements) {
  if (!measurements.length) return { offset: 0, rtt: 0, jitter: 0 };
  const sorted = [...measurements].sort((a, b) => a.rtt - b.rtt);
  const candidates = sorted.slice(0, Math.min(3, sorted.length)).sort((a, b) => a.offset - b.offset);
  const offset = candidates[Math.floor(candidates.length / 2)].offset;
  const rtt = sorted[0].rtt;
  const offsets = candidates.map((sample) => sample.offset);
  const jitter = offsets.length > 1 ? Math.max(...offsets) - Math.min(...offsets) : 0;
  return { offset, rtt, jitter };
}

export function validateClockProbePair(first, second, toleranceMs = PROBE_GAP_TOLERANCE_MS) {
  if (!first || !second || first.groupId !== second.groupId) return null;
  const clientGap = second.t0 - first.t0;
  const serverGap = second.t1 - first.t1;
  if (!Number.isFinite(clientGap) || !Number.isFinite(serverGap)) return null;
  if (Math.abs(serverGap - clientGap) > toleranceMs) return null;
  return first.rtt <= second.rtt ? first : second;
}

export function expandTimestamp32(encoded, referenceEpoch) {
  const low = Number(encoded) >>> 0;
  const base = Math.floor(referenceEpoch / TIMESTAMP_MODULO) * TIMESTAMP_MODULO;
  let candidate = base + low;
  if (candidate - referenceEpoch > TIMESTAMP_MODULO / 2) candidate -= TIMESTAMP_MODULO;
  if (referenceEpoch - candidate > TIMESTAMP_MODULO / 2) candidate += TIMESTAMP_MODULO;
  return candidate;
}

export function createClockSync({ intervalMs = () => 5000, onUpdate = () => {} } = {}) {
  const measurements = [];
  const pending = new Map();
  const pairs = new Map();
  const timers = new Set();
  let sequence = 0;
  let groupSequence = 0;
  let sendMessage = null;
  let estimate = { offset: 0, rtt: 0, jitter: 0, synced: false };

  function start(send) {
    stop();
    sendMessage = send;
    scheduleProbe(0);
  }

  function stop() {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
    pending.clear();
    pairs.clear();
  }

  function reset() {
    stop();
    measurements.length = 0;
    estimate = { offset: 0, rtt: 0, jitter: 0, synced: false };
  }

  function setTimer(callback, delay) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }

  function sendProbe(groupId, groupIndex) {
    if (!sendMessage) return;
    const id = ++sequence;
    const t0 = epochNow();
    pending.set(id, { groupId, groupIndex, t0 });
    sendMessage({ t: "clockProbe", id, t0, groupId, groupIndex });
  }

  function scheduleProbe(delay) {
    if (!sendMessage) return;
    setTimer(() => {
      const groupId = ++groupSequence;
      sendProbe(groupId, 0);
      setTimer(() => sendProbe(groupId, 1), PROBE_GAP_MS);
      for (const [pendingId] of pending) {
        if (pendingId < sequence - 16) pending.delete(pendingId);
      }
      for (const pendingGroupId of pairs.keys()) {
        if (pendingGroupId < groupId - 8) pairs.delete(pendingGroupId);
      }
      const warmup = measurements.length < 6;
      scheduleProbe(warmup ? 300 : Number(intervalMs()) || 5000);
    }, delay);
  }

  function handle(message) {
    if (message?.t !== "clockProbe") return false;
    if (!pending.has(message.id)) return true;
    const probe = pending.get(message.id);
    pending.delete(message.id);
    const measurement = computeClockMeasurement(message);
    if (!measurement) return true;
    const sample = { ...measurement, ...probe };
    const pair = pairs.get(probe.groupId) || [];
    pair[probe.groupIndex] = sample;
    pairs.set(probe.groupId, pair);
    if (!pair[0] || !pair[1]) return true;
    pairs.delete(probe.groupId);
    const accepted = validateClockProbePair(pair[0], pair[1]);
    if (!accepted) return true;
    measurements.push(accepted);
    if (measurements.length > 16) measurements.splice(0, measurements.length - 16);
    const next = bestClockEstimate(measurements);
    const blend = estimate.synced ? 0.2 : 1;
    estimate = {
      offset: estimate.offset + (next.offset - estimate.offset) * blend,
      rtt: next.rtt,
      jitter: next.jitter,
      synced: measurements.length >= 2
    };
    onUpdate({ ...estimate, samples: measurements.length });
    return true;
  }

  function serverEpochNow() {
    return epochNow() + estimate.offset;
  }

  function serverTimestamp32() {
    return Math.floor(serverEpochNow()) >>> 0;
  }

  function localPerformanceForServerTimestamp(encoded) {
    if (!estimate.synced) return performance.now();
    const serverEpoch = expandTimestamp32(encoded, serverEpochNow());
    return serverEpoch - estimate.offset - performance.timeOrigin;
  }

  function snapshot() {
    return { ...estimate, samples: measurements.length };
  }

  function isSynced() {
    return estimate.synced;
  }

  return { handle, isSynced, localPerformanceForServerTimestamp, reset, serverEpochNow, serverTimestamp32, snapshot, start, stop };
}
