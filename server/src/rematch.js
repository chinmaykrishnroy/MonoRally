export const REMATCH_TIMEOUT_MS = 15000;

/**
 * Evaluates a rematch request from a player.
 * @param {object} room Room state
 * @param {string} clientId Requesting client ID
 * @param {Array} humanPlayers Connected human player objects
 * @returns {{ ok: boolean, error?: string, immediate?: boolean, acceptedCount?: number, totalNeeded?: number, timeLeft?: number }}
 */
export function evaluateRematchRequest(room, clientId, humanPlayers) {
  if (!room || room.status !== "ended") {
    return { ok: false, error: "Replay is available after game over" };
  }
  if (!room.rematchConsent) room.rematchConsent = new Set();

  const humans = (humanPlayers || []).filter((p) => !p.bot && !p.disconnected && p.clientId);

  // If 1 or fewer humans (solo practice or playing with AI), restart immediately
  if (humans.length <= 1) {
    room.rematchConsent.clear();
    return { ok: true, immediate: true };
  }

  // Multi-human competitive match: track mutual consent
  room.rematchConsent.add(clientId);
  const acceptedCount = room.rematchConsent.size;
  const totalNeeded = humans.length;

  if (acceptedCount >= totalNeeded) {
    room.rematchConsent.clear();
    return { ok: true, immediate: true, acceptedCount, totalNeeded };
  }

  return { ok: true, immediate: false, acceptedCount, totalNeeded, timeLeft: Math.round(REMATCH_TIMEOUT_MS / 1000) };
}

/**
 * Handles rematch state when a player leaves or disconnects.
 * @param {object} room Room state
 * @param {string} clientId Departing client ID
 * @returns {{ declined: boolean, message: string } | null}
 */
export function handlePlayerLeaveRematch(room, clientId) {
  if (!room) return null;
  if (room.rematchConsent?.has(clientId)) {
    room.rematchConsent.delete(clientId);
  }
  if (room.rematchTimer && room.status === "ended") {
    clearTimeout(room.rematchTimer);
    room.rematchTimer = null;
    room.rematchConsent?.clear();
    return { declined: true, message: "A player left the room." };
  }
  return null;
}
