import { STATE_PACKET } from "./config.js";

export function jsonState(room, now, mechanics) {
  return {
    t: "state",
    serverNow: now,
    room: room.code,
    mode: room.mode,
    status: room.status,
    elapsed: room.startedAt ? (now - room.startedAt) / 1000 : 0,
    missLimit: room.missLimit,
    misses: room.misses,
    winner: room.winner,
    players: room.players.filter((p) => !p.disconnected).map((p) => ({
      id: p.clientId || p.id,
      name: p.name,
      team: p.team,
      slot: p.slot,
      x: p.x,
      w: mechanics.paddleWidth(p, now),
      laser: mechanics.laserStrength(p, now) > 0,
      emp: mechanics.empStrength(p, now) > 0
    })),
    balls: room.balls.map((b) => ({ x: b.x, y: b.y, r: b.r, bump: now - b.bump < 90 })),
    power: room.power,
    lastHit: room.lastHit && now - room.lastHit.at < 120 ? room.lastHit : null,
    lastPower: room.lastPower && now - room.lastPower.at < 1800 ? room.lastPower : null,
    countdown: mechanics.countdownValue(room, now),
    spectators: room.spectators.length
  };
}

export function statePacket(room, now, mechanics) {
  const players = room.players.filter((player) => !player.disconnected);
  const balls = room.balls;
  const hasPower = room.power ? 1 : 0;
  const hasLastHit = room.lastHit && now - room.lastHit.at < 120 ? 1 : 0;
  const hasLastPower = room.lastPower && now - room.lastPower.at < 1800 ? 1 : 0;
  const size = 20 + players.length * 12 + balls.length * 16 + hasPower * 16 + hasLastHit * 12 + hasLastPower * 8;
  const packet = Buffer.allocUnsafe(size);
  let o = 0;

  packet[o++] = STATE_PACKET;
  packet[o++] = room.mode === "2v2" ? 2 : 1;
  packet[o++] = statusCode(room.status);
  packet[o++] = players.length;
  packet[o++] = balls.length;
  packet[o++] = hasPower | (hasLastHit << 1) | (hasLastPower << 2);
  packet[o++] = room.missLimit;
  packet[o++] = Math.min(255, room.spectators.length);
  packet.writeFloatLE(now, o);
  o += 4;
  packet.writeFloatLE(room.startedAt ? (now - room.startedAt) / 1000 : 0, o);
  o += 4;
  packet[o++] = Math.min(255, room.misses.top);
  packet[o++] = Math.min(255, room.misses.bottom);
  packet[o++] = teamCode(room.winner);
  packet[o++] = mechanics.countdownValue(room, now);

  for (const p of players) {
    packet[o++] = p.slot < 0 ? 255 : p.slot;
    packet[o++] = teamCode(p.team);
    packet[o++] = (mechanics.laserStrength(p, now) > 0 ? 1 : 0) | (mechanics.empStrength(p, now) > 0 ? 2 : 0);
    packet[o++] = 0;
    packet.writeFloatLE(p.x, o);
    o += 4;
    packet.writeFloatLE(mechanics.paddleWidth(p, now), o);
    o += 4;
  }

  for (const b of balls) {
    packet.writeFloatLE(b.x, o);
    o += 4;
    packet.writeFloatLE(b.y, o);
    o += 4;
    packet.writeFloatLE(b.r, o);
    o += 4;
    packet[o++] = now - b.bump < 90 ? 1 : 0;
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
    packet.writeFloatLE(room.lastHit.x, o);
    o += 4;
    packet.writeFloatLE(room.lastHit.y, o);
    o += 4;
    packet.writeFloatLE(room.lastHit.at, o);
    o += 4;
  }

  if (hasLastPower) {
    packet[o++] = powerCode(room.lastPower.type);
    packet[o++] = teamCode(room.lastPower.team);
    packet[o++] = 0;
    packet[o++] = 0;
    packet.writeFloatLE(room.lastPower.at, o);
    o += 4;
  }

  return packet;
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
