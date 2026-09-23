/**
 * Elo Rating Engine for MonoRally Competitive Ranked Play
 * Implements standard Elo with K=32, symmetrical rating exchange, and tier boundaries.
 */

export const DEFAULT_ELO = 1200;
export const DEFAULT_K = 32;

export const RANK_TIERS = [
  { tier: "Bronze", min: 0, max: 1199, color: "#cd7f32", badge: "BRONZE" },
  { tier: "Silver", min: 1200, max: 1399, color: "#c0c0c0", badge: "SILVER" },
  { tier: "Gold", min: 1400, max: 1599, color: "#ffd700", badge: "GOLD" },
  { tier: "Platinum", min: 1600, max: 1799, color: "#00f0ff", badge: "PLATINUM" },
  { tier: "Diamond", min: 1800, max: 1999, color: "#bf5af2", badge: "DIAMOND" },
  { tier: "Master", min: 2000, max: Infinity, color: "#ff3b30", badge: "MASTER" }
];

export function getRankTier(eloRating = DEFAULT_ELO) {
  const elo = Math.max(100, Math.round(Number(eloRating) || DEFAULT_ELO));
  for (let i = RANK_TIERS.length - 1; i >= 0; i -= 1) {
    const t = RANK_TIERS[i];
    if (elo >= t.min) {
      const nextTier = RANK_TIERS[i + 1] || null;
      const tierRange = Number.isFinite(t.max) ? t.max - t.min + 1 : 500;
      const progress = Number.isFinite(t.max)
        ? Math.min(100, Math.max(0, Math.round(((elo - t.min) / tierRange) * 100)))
        : 100;
      return {
        tier: t.tier,
        badge: t.badge,
        color: t.color,
        min: t.min,
        max: t.max,
        progress,
        nextTier: nextTier?.tier || null,
        nextThreshold: nextTier ? nextTier.min : null
      };
    }
  }
  return { ...RANK_TIERS[0], progress: 0, nextTier: "Silver", nextThreshold: 1200 };
}

export function calculateExpectedScore(ratingA, ratingB) {
  const diff = (Number(ratingB) || DEFAULT_ELO) - (Number(ratingA) || DEFAULT_ELO);
  return 1 / (1 + Math.pow(10, diff / 400));
}

export function calculateEloDelta(ratingA, ratingB, actualScoreA, k = DEFAULT_K) {
  const expectedA = calculateExpectedScore(ratingA, ratingB);
  return Math.round(k * (actualScoreA - expectedA));
}

export function calculateMatchElo({ teamA = [], teamB = [], winnerTeam, k = DEFAULT_K }) {
  if (!teamA.length || !teamB.length) return new Map();

  const avgA = teamA.reduce((sum, p) => sum + (Number(p.elo) || DEFAULT_ELO), 0) / teamA.length;
  const avgB = teamB.reduce((sum, p) => sum + (Number(p.elo) || DEFAULT_ELO), 0) / teamB.length;

  const scoreA = winnerTeam === "bottom" || winnerTeam === "teamA" ? 1 : winnerTeam === "top" || winnerTeam === "teamB" ? 0 : 0.5;
  const deltaA = calculateEloDelta(avgA, avgB, scoreA, k);
  const deltaB = -deltaA;

  const results = new Map();

  for (const player of teamA) {
    const current = Number(player.elo) || DEFAULT_ELO;
    const next = Math.max(100, current + deltaA);
    results.set(player.id || player.profileId || player.clientId, {
      ratingBefore: current,
      ratingAfter: next,
      delta: deltaA
    });
  }

  for (const player of teamB) {
    const current = Number(player.elo) || DEFAULT_ELO;
    const next = Math.max(100, current + deltaB);
    results.set(player.id || player.profileId || player.clientId, {
      ratingBefore: current,
      ratingAfter: next,
      delta: deltaB
    });
  }

  return results;
}
