import { calculateMatchElo } from "./elo.js";

/**
 * Finalizes ended matches, updates player stats, calculates Elo adjustments,
 * records leaderboard entries and stores match history.
 */
export async function finalizeMatch(room, { leaderboard = null, playerRepository = null, matchRepository = null } = {}) {
  if (!room || room.status !== "ended" || !room.winner || room.matchFinalized) return;
  room.matchFinalized = true;

  if (leaderboard) {
    try {
      await leaderboard.recordRoom(room);
    } catch (err) {
      console.error("[match-finalizer] Error recording leaderboard:", err.message);
    }
  }

  const bottomHumans = room.players.filter((p) => p.team === "bottom" && !p.bot && (p.profileId || p.id));
  const topHumans = room.players.filter((p) => p.team === "top" && !p.bot && (p.profileId || p.id));

  let eloResults = new Map();

  // If both teams have human players, calculate Elo rating deltas
  if (bottomHumans.length > 0 && topHumans.length > 0 && room.winner && playerRepository) {
    for (const p of room.players) {
      if (!p.bot && (p.profileId || p.id)) {
        const profile = await playerRepository.getPlayer(p.profileId || p.id).catch(() => null);
        p.elo = profile ? profile.eloRating : 1200;
      }
    }

    eloResults = calculateMatchElo({
      teamA: bottomHumans,
      teamB: topHumans,
      winnerTeam: room.winner
    });
    room.eloResults = eloResults;
  }

  // Update persistent stats for each human player
  if (playerRepository) {
    for (const p of room.players) {
      if (!p.bot && (p.profileId || p.id)) {
        const pId = p.profileId || p.id;
        const won = p.team === room.winner;
        const eloData = eloResults.get(pId) || eloResults.get(p.clientId);
        const delta = eloData ? eloData.delta : 0;
        const peakSpeed = Math.round(room.peakSpeed || 0);
        const skillShots = p.skillShots || { smash: 0, curve: 0, counter: 0, drive: 0 };

        await playerRepository.updatePlayerStats(pId, {
          won,
          ratingDelta: delta,
          peakSpeed,
          skillShots
        }).catch((err) => console.error("[match-finalizer] Error updating player stats:", err.message));
      }
    }
  }

  if (matchRepository) {
    try {
      await matchRepository.recordMatch(room, eloResults);
    } catch (err) {
      console.error("[match-finalizer] Error recording match:", err.message);
    }
  }
}
