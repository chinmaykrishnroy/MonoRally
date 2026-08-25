import { H, SCORED_STATE_PACKET, STATE_PACKET, W } from "./config.js";
import { encodeTimestamp32 } from "./input-timeline.js";

const LEGACY_STATE_PACKET = 1;

export function jsonState(room, now, mechanics) {
  return {
    t: "state",
    serverNow: performance.timeOrigin + now,
    room: room.code,
    mode: room.mode,
    status: room.status,
    elapsed: elapsedSeconds(room, now),
    missLimit: room.missLimit,
    misses: room.misses,
    winner: room.winner,
    players: activePlayers(room).map((player) => ({
      id: player.clientId || player.id,
      name: player.name,
      team: player.team,
      slot: player.slot,
      x: player.x,
      vx: player.vx || 0,
      w: mechanics.paddleWidth(player, now),
      ack: player.lastProcessedInputSequence,
      score: player.returns || 0,
      laser: mechanics.laserStrength(player, now) > 0,
      emp: mechanics.empStrength(player, now) > 0
    })),
    balls: activeBalls(room).map((ball) => ({
      id: ball.id,
      x: ball.x,
      y: ball.y,
      r: ball.r,
      vx: ball.vx,
      vy: ball.vy,
      curve: ball.curve || 0,
      pending: Boolean(ball.pendingMiss),
      bump: now - ball.bump < 100
    })),
    power: room.power,
    lastHit: visibleHit(room, now),
    lastPower: visiblePower(room, now),
    countdown: mechanics.countdownValue(room, now),
    spectators: room.spectators.length
  };
}

export function statePacket(room, now, mechanics, includePlayerScores = false) {
  const players = activePlayers(room);
  const balls = activeBalls(room);
  const lastHit = visibleHit(room, now);
  const lastPower = visiblePower(room, now);
  const hasPower = room.power ? 1 : 0;
  const hasLastHit = lastHit ? 1 : 0;
  const hasLastPower = lastPower ? 1 : 0;
  const size = 20 + players.length * 12 + balls.length * 14 + hasPower * 8 + hasLastHit * 12 + hasLastPower * 8;
  const packet = Buffer.allocUnsafe(size);
  let o = writeHeader(
    packet,
    room,
    now,
    players.length,
    balls.length,
    hasPower,
    hasLastHit,
    hasLastPower,
    includePlayerScores ? SCORED_STATE_PACKET : STATE_PACKET,
    mechanics.countdownValue(room, now)
  );

  for (const player of players) {
    packet[o++] = player.slot < 0 ? 255 : player.slot;
    packet[o++] = teamCode(player.team);
    packet[o++] = (mechanics.laserStrength(player, now) > 0 ? 1 : 0) | (mechanics.empStrength(player, now) > 0 ? 2 : 0);
    packet[o++] = 0;
    packet.writeUInt16LE(encodeRange(player.x, 0, W), o);
    o += 2;
    packet.writeUInt16LE(encodeRange(mechanics.paddleWidth(player, now), 0, W), o);
    o += 2;
    packet.writeInt16LE(encodeVelocity(player.vx), o);
    o += 2;
    packet.writeUInt16LE(Number.isInteger(player.lastProcessedInputSequence) ? player.lastProcessedInputSequence & 0xffff : 0xffff, o);
    o += 2;
  }

  for (const ball of balls) {
    packet[o++] = Number(ball.id) & 0xff;
    packet[o++] = Math.round(ball.r);
    packet[o++] = (now - ball.bump < 100 ? 1 : 0) | (ball.pendingMiss ? 2 : 0);
    packet[o++] = 0;
    packet.writeUInt16LE(encodeRange(ball.x, 0, W), o);
    o += 2;
    packet.writeUInt16LE(encodeRange(ball.y, 0, H), o);
    o += 2;
    packet.writeInt16LE(encodeVelocity(ball.vx), o);
    o += 2;
    packet.writeInt16LE(encodeVelocity(ball.vy), o);
    o += 2;
    packet.writeInt16LE(encodeVelocity(ball.curve), o);
    o += 2;
  }

  if (hasPower) {
    packet[o++] = powerCode(room.power.type);
    packet[o++] = Math.round(room.power.r);
    packet[o++] = 0;
    packet[o++] = 0;
    packet.writeUInt16LE(encodeRange(room.power.x, 0, W), o);
    o += 2;
    packet.writeUInt16LE(encodeRange(room.power.y, 0, H), o);
    o += 2;
  }

  if (hasLastHit) {
    packet.writeUInt16LE(encodeRange(lastHit.x, 0, W), o);
    o += 2;
    packet.writeUInt16LE(encodeRange(lastHit.y, 0, H), o);
    o += 2;
    packet.writeUInt32LE(encodeTimestamp32(performance.timeOrigin + (lastHit.presentAt ?? lastHit.at)), o);
    o += 4;
    packet[o++] = Number.isInteger(lastHit.slot) && lastHit.slot >= 0 ? lastHit.slot : 255;
    packet[o++] = Math.round(clamp01(lastHit.intensity ?? 0.5) * 255);
    packet.writeUInt16LE(Math.min(65535, Math.max(0, Number(lastHit.score) || 0)), o);
    o += 2;
  }

  if (hasLastPower) {
    packet[o++] = powerCode(lastPower.type);
    packet[o++] = teamCode(lastPower.team);
    packet[o++] = 0;
    packet[o++] = 0;
    packet.writeUInt32LE(encodeTimestamp32(performance.timeOrigin + lastPower.at), o);
  }

  return packet;
}

export function scoredStatePacket(room, now, mechanics) {
  return statePacket(room, now, mechanics, true);
}

export function legacyStatePacket(room, now, mechanics) {
  const players = activePlayers(room);
  const balls = activeBalls(room).filter((ball) => !ball.pendingMiss);
  const lastHit = visibleHit(room, now);
  const lastPower = visiblePower(room, now);
  const hasPower = room.power ? 1 : 0;
  const hasLastHit = lastHit ? 1 : 0;
  const hasLastPower = lastPower ? 1 : 0;
  const size = 20 + players.length * 12 + balls.length * 16 + hasPower * 16 + hasLastHit * 12 + hasLastPower * 8;
  const packet = Buffer.allocUnsafe(size);
  let o = 0;

  packet[o++] = LEGACY_STATE_PACKET;
  packet[o++] = room.mode === "2v2" ? 2 : 1;
  packet[o++] = statusCode(room.status);
  packet[o++] = players.length;
  packet[o++] = balls.length;
  packet[o++] = hasPower | (hasLastHit << 1) | (hasLastPower << 2);
  packet[o++] = room.missLimit;
  packet[o++] = Math.min(255, room.spectators.length);
  packet.writeFloatLE(now, o);
  o += 4;
  packet.writeFloatLE(elapsedSeconds(room, now), o);
  o += 4;
  packet[o++] = Math.min(255, room.misses.top);
  packet[o++] = Math.min(255, room.misses.bottom);
  packet[o++] = teamCode(room.winner);
  packet[o++] = mechanics.countdownValue(room, now);

  for (const player of players) {
    packet[o++] = player.slot < 0 ? 255 : player.slot;
    packet[o++] = teamCode(player.team);
    packet[o++] = (mechanics.laserStrength(player, now) > 0 ? 1 : 0) | (mechanics.empStrength(player, now) > 0 ? 2 : 0);
    packet[o++] = 0;
    packet.writeFloatLE(player.x, o);
    o += 4;
    packet.writeFloatLE(mechanics.paddleWidth(player, now), o);
    o += 4;
  }

  for (const ball of balls) {
    packet.writeFloatLE(ball.x, o);
    o += 4;
    packet.writeFloatLE(ball.y, o);
    o += 4;
    packet.writeFloatLE(ball.r, o);
    o += 4;
    packet[o++] = now - ball.bump < 90 ? 1 : 0;
    packet[o++] = 0;
    packet[o++] = 0;
    packet[o++] = 0;
  }

  if (hasPower) {
    packet[o++] = powerCode(room.power.type);
    packet[o++] = 0;
    packet[o++] = 0;
    packet[o++] = 0;
    packet.writeFloatLE(room.power.x, o);
    o += 4;
    packet.writeFloatLE(room.power.y, o);
    o += 4;
    packet.writeFloatLE(room.power.r, o);
    o += 4;
  }

  if (hasLastHit) {
    packet.writeFloatLE(lastHit.x, o);
    o += 4;
    packet.writeFloatLE(lastHit.y, o);
    o += 4;
    packet.writeFloatLE(lastHit.at, o);
    o += 4;
  }

  if (hasLastPower) {
    packet[o++] = powerCode(lastPower.type);
    packet[o++] = teamCode(lastPower.team);
    packet[o++] = 0;
    packet[o++] = 0;
    packet.writeFloatLE(lastPower.at, o);
  }
  return packet;
}

function writeHeader(packet, room, now, playerCount, ballCount, hasPower, hasLastHit, hasLastPower, packetType, countdown) {
  let o = 0;
  packet[o++] = packetType;
  packet[o++] = room.mode === "2v2" ? 2 : 1;
  packet[o++] = statusCode(room.status);
  packet[o++] = playerCount;
  packet[o++] = ballCount;
  packet[o++] = hasPower | (hasLastHit << 1) | (hasLastPower << 2);
  packet[o++] = room.missLimit;
  packet[o++] = Math.min(255, room.spectators.length);
  packet.writeUInt32LE(encodeTimestamp32(performance.timeOrigin + now), o);
  o += 4;
  packet.writeFloatLE(elapsedSeconds(room, now), o);
  o += 4;
  packet[o++] = Math.min(255, room.misses.top);
  packet[o++] = Math.min(255, room.misses.bottom);
  packet[o++] = teamCode(room.winner);
  packet[o++] = countdown;
  return o;
}

function elapsedSeconds(room, now) {
  if (!room.startedAt) return 0;
  const effectiveNow = room.status === "ended" && Number.isFinite(room.endedAt) ? room.endedAt : now;
  return Math.max(0, (effectiveNow - room.startedAt) / 1000);
}

function activePlayers(room) {
  return room.players.filter((player) => !player.disconnected);
}

function activeBalls(room) {
  return room.balls.filter((ball) => !ball.dead);
}

function visibleHit(room, now) {
  return room.lastHit && now - room.lastHit.at < 220 ? room.lastHit : null;
}

function visiblePower(room, now) {
  return room.lastPower && now - room.lastPower.at < 1800 ? room.lastPower : null;
}

function encodeRange(value, min, max) {
  return Math.round(clamp01((Number(value) - min) / (max - min)) * 65535);
}

function encodeVelocity(value) {
  return Math.round(Math.max(-32767, Math.min(32767, Number(value) || 0)));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function statusCode(status) {
  if (status === "running") return 1;
  if (status === "ended") return 2;
  return 0;
}

function teamCode(team) {
  if (team === "top") return 1;
  if (team === "bottom") return 2;
  return 0;
}

function powerCode(type) {
  if (type === "multi") return 1;
  if (type === "laser") return 2;
  if (type === "emp") return 3;
  return 0;
}
