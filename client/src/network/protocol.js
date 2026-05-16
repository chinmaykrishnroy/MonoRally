export function parseStatePacket(buffer, nameForSlot) {
  const view = new DataView(buffer);
  let o = 0;
  if (view.getUint8(o++) !== 1) return null;
  const mode = view.getUint8(o++) === 2 ? "2v2" : "1v1";
  const status = ["waiting", "running", "ended"][view.getUint8(o++)] || "waiting";
  const playerCount = view.getUint8(o++);
  const ballCount = view.getUint8(o++);
  const flags = view.getUint8(o++);
  const missLimit = view.getUint8(o++);
  const spectators = view.getUint8(o++);
  const serverNow = view.getFloat32(o, true);
  o += 4;
  const elapsed = view.getFloat32(o, true);
  o += 4;
  const misses = { top: view.getUint8(o++), bottom: view.getUint8(o++) };
  const winner = teamName(view.getUint8(o++));
  const countdown = view.getUint8(o++);

  const players = [];
  for (let i = 0; i < playerCount; i += 1) {
    const encodedSlot = view.getUint8(o++);
    const slot = encodedSlot === 255 ? -1 : encodedSlot;
    const team = teamName(view.getUint8(o++));
    const playerFlags = view.getUint8(o++);
    o += 1;
    const x = view.getFloat32(o, true);
    o += 4;
    const w = view.getFloat32(o, true);
    o += 4;
    players.push({
      id: `slot-${slot}`,
      name: nameForSlot(slot),
      team,
      slot,
      x,
      w,
      laser: Boolean(playerFlags & 1),
      emp: Boolean(playerFlags & 2)
    });
  }

  const balls = [];
  for (let i = 0; i < ballCount; i += 1) {
    const x = view.getFloat32(o, true);
    o += 4;
    const y = view.getFloat32(o, true);
    o += 4;
    const r = view.getFloat32(o, true);
    o += 4;
    const bump = Boolean(view.getUint8(o++));
    o += 3;
    balls.push({ x, y, r, bump });
  }

  let power = null;
  if (flags & 1) {
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
  if (flags & 2) {
    const x = view.getFloat32(o, true);
    o += 4;
    const y = view.getFloat32(o, true);
    o += 4;
    const at = view.getFloat32(o, true);
    o += 4;
    lastHit = { x, y, at };
  }

  let lastPower = null;
  if (flags & 4) {
    const type = powerName(view.getUint8(o++));
    const team = teamName(view.getUint8(o++));
    o += 2;
    const at = view.getFloat32(o, true);
    lastPower = { type, team, player: team, at };
  }

  return {
    t: "state",
    serverNow,
    mode,
    status,
    elapsed,
    missLimit,
    misses,
    winner,
    players,
    balls,
    power,
    lastHit,
    lastPower,
    countdown,
    spectators
  };
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
