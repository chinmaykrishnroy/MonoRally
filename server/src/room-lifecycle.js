import crypto from "node:crypto";
import { MISS_LIMIT_1V1, MISS_LIMIT_2V2, POWERUP_MAX_MS, POWERUP_MIN_MS, W } from "./config.js";
import { beginCountdown } from "./physics.js";
import { rand, startingXForSlot } from "./utils.js";

export function createRoomLifecycle(rooms) {
  function makeRoom(mode, quick) {
    return {
      code: uniqueCode(),
      quick,
      mode,
      maxPlayers: mode === "2v2" ? 4 : 2,
      missLimit: mode === "2v2" ? MISS_LIMIT_2V2 : MISS_LIMIT_1V1,
      players: [],
      spectators: [],
      status: "waiting",
      startedAt: 0,
      lastTick: performance.now(),
      misses: { top: 0, bottom: 0 },
      balls: [],
      power: null,
      nextPowerAt: performance.now() + 8000,
      nextPublishAt: 0,
      countdownUntil: 0,
      serveTeam: "top",
      pendingCountdown: false,
      lastMissTeam: null,
      winner: null
    };
  }

  function uniqueCode() {
    let code = "";
    do code = crypto.randomBytes(3).toString("hex").toUpperCase();
    while (rooms.has(code));
    return code;
  }

  function startRoom(room) {
    room.status = "running";
    room.startedAt = performance.now();
    room.lastTick = room.startedAt;
    room.misses = { top: 0, bottom: 0 };
    room.winner = null;
    room.power = null;
    room.lastHit = null;
    room.lastPower = null;
    room.pendingCountdown = false;
    room.lastMissTeam = null;
    resetPlayers(room);
    room.balls = [];
    room.nextPowerAt = performance.now() + rand(POWERUP_MIN_MS, POWERUP_MAX_MS);
    room.nextPublishAt = room.startedAt;
    beginCountdown(room, room.startedAt, room.mode === "2v2" ? "both" : "top");
  }

  function resetPlayers(room) {
    for (const player of room.players) {
      if (room.mode === "2v2") {
        player.team = player.slot < 2 ? "bottom" : "top";
        player.x = startingXForSlot(player.slot);
      } else {
        player.x = W / 2;
      }
      player.targetX = player.x;
      player.laserActiveUntil = 0;
      player.laserFadeUntil = 0;
      player.empActiveUntil = 0;
      player.empFadeUntil = 0;
    }
  }

  return { makeRoom, startRoom };
}
