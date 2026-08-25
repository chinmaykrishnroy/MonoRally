import { H } from "../core/shared.js";

export function playerTeamForSnapshot(snapshot, playerState) {
  if (!snapshot || playerState.role !== "player") return playerState.team;
  return snapshot.players?.find((player) => player.slot === playerState.slot)?.team || playerState.team;
}

export function shouldFlipPlayerView(snapshot, playerState) {
  return Boolean(playerState.online && playerState.role === "player" && playerTeamForSnapshot(snapshot, playerState) === "top");
}

export function orientSnapshotForPlayer(snapshot, playerState) {
  if (!snapshot || !shouldFlipPlayerView(snapshot, playerState)) return snapshot;
  return {
    ...snapshot,
    misses: {
      top: snapshot.misses.bottom,
      bottom: snapshot.misses.top
    },
    winner: flipTeam(snapshot.winner),
    players: snapshot.players.map((player) => ({ ...player, team: flipTeam(player.team) })),
    balls: snapshot.balls.map((ball) => ({ ...ball, y: H - ball.y, vy: -(ball.vy || 0) })),
    power: snapshot.power ? { ...snapshot.power, y: H - snapshot.power.y } : null,
    lastHit: snapshot.lastHit ? { ...snapshot.lastHit, y: H - snapshot.lastHit.y } : null,
    lastPower: snapshot.lastPower ? { ...snapshot.lastPower, team: flipTeam(snapshot.lastPower.team) } : snapshot.lastPower
  };
}

export function orientYForPlayer(y, snapshot, playerState) {
  return shouldFlipPlayerView(snapshot, playerState) ? H - y : y;
}

function flipTeam(team) {
  if (team === "top") return "bottom";
  if (team === "bottom") return "top";
  return team;
}
