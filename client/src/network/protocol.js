import { H, W } from "../core/shared.js";

export function parseStatePacket(buffer, nameForSlot) {
  const view = new DataView(buffer);
  if (!view.byteLength) return null;
  const packetType = view.getUint8(0);
  if (packetType === 3) return parseTrajectoryPacket(view, nameForSlot, true);
  if (packetType === 2) return parseTrajectoryPacket(view, nameForSlot, false);
  if (packetType === 1) return parseLegacyPacket(view, nameForSlot);
  return null;
}

function parseTrajectoryPacket(view, nameForSlot, scored) {
  let o = 1;
  const header = readHeader(view, o, true);
  o = header.offset;
  const players = [];
  for (let i = 0; i < header.playerCount; i += 1) {
    const encodedSlot = view.getUint8(o++);
    const slot = encodedSlot === 255 ? -1 : encodedSlot;
    const team = teamName(view.getUint8(o++));
    const flags = view.getUint8(o++);
    o += 1;
    const x = decodeRange(view.getUint16(o, true), 0, W);
    o += 2;
    const w = decodeRange(view.getUint16(o, true), 0, W);
    o += 2;
    const vx = view.getInt16(o, true);
    o += 2;
    const encodedAck = view.getUint16(o, true);
    o += 2;
    players.push({
      id: `slot-${slot}`,
      name: nameForSlot(slot),
      team,
      slot,
      x,
      w,
      vx,
      ack: encodedAck === 0xffff ? null : encodedAck,
      score: 0,
      laser: Boolean(flags & 1),
      emp: Boolean(flags & 2)
    });
  }

  const balls = [];
  for (let i = 0; i < header.ballCount; i += 1) {
    const id = view.getUint8(o++);
    const r = view.getUint8(o++);
    const flags = view.getUint8(o++);
    o += 1;
    const x = decodeRange(view.getUint16(o, true), 0, W);
    o += 2;
    const y = decodeRange(view.getUint16(o, true), 0, H);
    o += 2;
    const vx = view.getInt16(o, true);
    o += 2;
    const vy = view.getInt16(o, true);
    o += 2;
    const curve = view.getInt16(o, true);
    o += 2;
    balls.push({ id, x, y, r, vx, vy, curve, bump: Boolean(flags & 1), pending: Boolean(flags & 2) });
  }

  let power = null;
  if (header.flags & 1) {
    const type = powerName(view.getUint8(o++));
    const r = view.getUint8(o++);
    o += 2;
    const x = decodeRange(view.getUint16(o, true), 0, W);
    o += 2;
    const y = decodeRange(view.getUint16(o, true), 0, H);
    o += 2;
    power = { type, x, y, r };
  }

  let lastHit = null;
  if (header.flags & 2) {
    const x = decodeRange(view.getUint16(o, true), 0, W);
    o += 2;
    const y = decodeRange(view.getUint16(o, true), 0, H);
    o += 2;
    const at = view.getUint32(o, true);
    o += 4;
    const encodedSlot = view.getUint8(o++);
    const intensity = view.getUint8(o++) / 255;
    const score = scored ? view.getUint16(o, true) : 0;
    o += 2;
    lastHit = { x, y, at, slot: encodedSlot === 255 ? -1 : encodedSlot, intensity, score };
  }

  let lastPower = null;
  if (header.flags & 4) {
    const type = powerName(view.getUint8(o++));
    const team = teamName(view.getUint8(o++));
    o += 2;
    const at = view.getUint32(o, true);
    lastPower = { type, team, player: team, at };
  }

  return stateFromHeader(header, players, balls, power, lastHit, lastPower, scored ? 4 : 3);
}

function parseLegacyPacket(view, nameForSlot) {
  let o = 1;
  const header = readHeader(view, o, false);
  o = header.offset;
  const players = [];
  for (let i = 0; i < header.playerCount; i += 1) {
    const encodedSlot = view.getUint8(o++);
    const slot = encodedSlot === 255 ? -1 : encodedSlot;
    const team = teamName(view.getUint8(o++));
    const playerFlags = view.getUint8(o++);
    o += 1;
    const x = view.getFloat32(o, true);
    o += 4;
    const w = view.getFloat32(o, true);
    o += 4;
    players.push({ id: `slot-${slot}`, name: nameForSlot(slot), team, slot, x, w, vx: 0, ack: null, laser: Boolean(playerFlags & 1), emp: Boolean(playerFlags & 2) });
  }

  const balls = [];
  for (let i = 0; i < header.ballCount; i += 1) {
    const x = view.getFloat32(o, true);
    o += 4;
    const y = view.getFloat32(o, true);
    o += 4;
    const r = view.getFloat32(o, true);
    o += 4;
    const bump = Boolean(view.getUint8(o++));
    o += 3;
    balls.push({ id: i, x, y, r, vx: 0, vy: 0, curve: 0, bump, pending: false });
  }

  let power = null;
  if (header.flags & 1) {
    const type = powerName(view.getUint8(o++));
    o += 3;
    const x = view.getFloat32(o, true);
    o += 4;
    const y = view.getFloat32(o, true);
    o += 4;
    const r = view.getFloat32(o, true);
    o += 4;
    power = { type, x, y, r };
  }

  let lastHit = null;
  if (header.flags & 2) {
    const x = view.getFloat32(o, true);
    o += 4;
    const y = view.getFloat32(o, true);
    o += 4;
    const at = view.getFloat32(o, true);
    o += 4;
    lastHit = { x, y, at, slot: -1, intensity: 0.5 };
  }

  let lastPower = null;
  if (header.flags & 4) {
    const type = powerName(view.getUint8(o++));
    const team = teamName(view.getUint8(o++));
    o += 2;
    const at = view.getFloat32(o, true);
    lastPower = { type, team, player: team, at };
  }
  return stateFromHeader(header, players, balls, power, lastHit, lastPower);
}

function readHeader(view, offset, trajectory) {
  let o = offset;
  const mode = view.getUint8(o++) === 2 ? "2v2" : "1v1";
  const status = ["waiting", "running", "ended"][view.getUint8(o++)] || "waiting";
  const playerCount = view.getUint8(o++);
  const ballCount = view.getUint8(o++);
  const flags = view.getUint8(o++);
  const missLimit = view.getUint8(o++);
  const spectators = view.getUint8(o++);
  const serverNow = trajectory ? view.getUint32(o, true) : view.getFloat32(o, true);
  o += 4;
  const elapsed = view.getFloat32(o, true);
  o += 4;
  const misses = { top: view.getUint8(o++), bottom: view.getUint8(o++) };
  const winner = teamName(view.getUint8(o++));
  const countdown = view.getUint8(o++);
  return { mode, status, playerCount, ballCount, flags, missLimit, spectators, serverNow, elapsed, misses, winner, countdown, trajectory, offset: o };
}

function stateFromHeader(header, players, balls, power, lastHit, lastPower, protocol = header.trajectory ? 3 : 2) {
  return {
    t: "state",
    protocol,
    serverNow: header.serverNow,
    mode: header.mode,
    status: header.status,
    elapsed: header.elapsed,
    missLimit: header.missLimit,
    misses: header.misses,
    winner: header.winner,
    players,
    balls,
    power,
    lastHit,
    lastPower,
    countdown: header.countdown,
    spectators: header.spectators
  };
}

function decodeRange(value, min, max) {
  return min + (value / 65535) * (max - min);
}

export function teamName(code) {
  if (code === 1) return "top";
  if (code === 2) return "bottom";
  return null;
}

export function powerName(code) {
  if (code === 1) return "multi";
  if (code === 2) return "laser";
  if (code === 3) return "emp";
  return "";
}

export function labelPower(type) {
  return type === "multi" ? "x4" : type === "laser" ? "<>" : "EMP";
}
