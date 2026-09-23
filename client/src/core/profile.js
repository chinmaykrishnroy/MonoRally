import { PROFILE_KEY, generatedHandle } from "./shared.js";

export function createDefaultProfile() {
  const handle = generatedHandle();
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    id,
    handle,
    displayName: handle,
    eloRating: 1200,
    peakRating: 1200,
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    currentStreak: 0,
    bestStreak: 0,
    peakSpeed: 0,
    smashCount: 0,
    curveCount: 0,
    counterCount: 0,
    driveCount: 0,
    winRate: 0,
    rankTier: {
      tier: "Silver",
      badge: "SILVER",
      color: "#c0c0c0",
      min: 1200,
      max: 1399,
      progress: 0,
      nextTier: "Gold",
      nextThreshold: 1400
    }
  };
}

export function loadLocalProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.id) {
        return {
          ...createDefaultProfile(),
          ...parsed
        };
      }
    }
  } catch {
    // Ignore storage parse errors
  }
  const fresh = createDefaultProfile();
  saveLocalProfile(fresh);
  return fresh;
}

export function saveLocalProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore quota errors
  }
}

export async function syncProfileWithServer(profile) {
  try {
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: profile.id,
        handle: profile.handle,
        displayName: profile.displayName || profile.display_name || profile.handle
      })
    });
    if (!res.ok) return profile;
    const data = await res.json();
    if (data.profile) {
      const merged = { ...profile, ...data.profile };
      saveLocalProfile(merged);
      return merged;
    }
  } catch {
    // Background sync error; offline graceful fallback
  }
  return profile;
}

export async function fetchRemoteProfile(id) {
  try {
    const res = await fetch(`/api/profile?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchRankedLeaderboard(limit = 25) {
  try {
    const res = await fetch(`/api/ranked/leaderboard?limit=${encodeURIComponent(limit)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.leaderboard || [];
  } catch {
    return [];
  }
}

export function calculateAchievements(profile) {
  const p = profile || {};
  return [
    {
      id: "first_blood",
      title: "Rookie Pilot",
      desc: "Complete your first match",
      icon: "🚀",
      unlocked: (p.matchesPlayed || 0) >= 1
    },
    {
      id: "centurion",
      title: "Rally Centurion",
      desc: "Achieve 5 match victories",
      icon: "⚔️",
      unlocked: (p.wins || 0) >= 5
    },
    {
      id: "gold_standard",
      title: "Gold Standard",
      desc: "Reach Gold Tier (1400+ Elo)",
      icon: "🏆",
      unlocked: (p.eloRating || 1200) >= 1400 || (p.peakRating || 1200) >= 1400
    },
    {
      id: "streak_master",
      title: "Unstoppable",
      desc: "Record a 3-match win streak",
      icon: "🔥",
      unlocked: (p.bestStreak || 0) >= 3
    },
    {
      id: "sonic_boomer",
      title: "Sonic Boomer",
      desc: "Surpass 800 px/s peak speed",
      icon: "⚡",
      unlocked: (p.peakSpeed || 0) >= 800
    },
    {
      id: "smash_specialist",
      title: "Smash Specialist",
      desc: "Land 10 Smash skill shots",
      icon: "💥",
      unlocked: (p.smashCount || 0) >= 10
    },
    {
      id: "spin_doctor",
      title: "Spin Doctor",
      desc: "Execute 10 wicked Curve shots",
      icon: "🌀",
      unlocked: (p.curveCount || 0) >= 10
    },
    {
      id: "parry_master",
      title: "Parry Master",
      desc: "Land 10 Counter returns",
      icon: "🛡️",
      unlocked: (p.counterCount || 0) >= 10
    }
  ];
}
