import { calculateAchievements, fetchRemoteProfile, loadLocalProfile, saveLocalProfile, syncProfileWithServer } from "../core/profile.js";
import { defaultReplayStore } from "../replay/replay-store.js";

export function createProfileUi({ elements, state, onWatchReplay } = {}) {
  const {
    $,
    profileBtn,
    profileModal,
    overlay
  } = elements;

  let currentProfile = loadLocalProfile();

  async function init() {
    // Initial sync with server
    currentProfile = await syncProfileWithServer(currentProfile);
    if (state) state.profile = currentProfile;
  }

  function getProfile() {
    return currentProfile;
  }

  async function openProfile() {
    // Fetch latest remote stats if possible
    const remote = await fetchRemoteProfile(currentProfile.id);
    if (remote && remote.profile) {
      currentProfile = { ...currentProfile, ...remote.profile };
      saveLocalProfile(currentProfile);
      renderProfile(currentProfile, remote.matches || []);
    } else {
      renderProfile(currentProfile, []);
    }

    if (overlay) overlay.classList.remove("hidden");
    if (profileModal) profileModal.classList.remove("hidden");
  }

  function closeProfile() {
    if (profileModal) profileModal.classList.add("hidden");
    const otherModalsOpen = document.querySelectorAll(".modal:not(.hidden)");
    if (!otherModalsOpen.length && overlay) {
      overlay.classList.add("hidden");
    }
  }

  function renderProfile(profile, matches = []) {
    const tier = profile.rankTier || { tier: "Silver", color: "#c0c0c0", badge: "SILVER", progress: 0 };

    const badgeIcon = $("profileBadgeIcon");
    if (badgeIcon) {
      badgeIcon.textContent = (profile.displayName || profile.handle || "P").slice(0, 2).toUpperCase();
      badgeIcon.style.borderColor = tier.color;
      badgeIcon.style.color = tier.color;
    }

    const displayNameEl = $("profileDisplayName");
    if (displayNameEl) displayNameEl.textContent = profile.displayName || profile.handle;

    const handleEl = $("profileHandle");
    if (handleEl) handleEl.textContent = `@${profile.handle}`;

    const tierPill = $("profileTierPill");
    if (tierPill) {
      tierPill.textContent = tier.badge || tier.tier;
      tierPill.style.backgroundColor = `${tier.color}22`;
      tierPill.style.borderColor = tier.color;
      tierPill.style.color = tier.color;
    }

    const eloValueEl = $("profileEloValue");
    if (eloValueEl) eloValueEl.textContent = `${profile.eloRating || 1200} Elo`;

    const peakEloEl = $("profilePeakElo");
    if (peakEloEl) peakEloEl.textContent = `Peak: ${profile.peakRating || profile.eloRating || 1200}`;

    const nextTierText = $("profileNextTierText");
    if (nextTierText) {
      if (tier.nextTier && tier.nextThreshold) {
        nextTierText.textContent = `${tier.nextThreshold - (profile.eloRating || 1200)} Elo to ${tier.nextTier}`;
      } else {
        nextTierText.textContent = "Maximum Rank Tier";
      }
    }

    const progressBar = $("profileTierProgressBar");
    if (progressBar) {
      progressBar.style.width = `${tier.progress || 0}%`;
      progressBar.style.backgroundColor = tier.color;
    }

    const matchesPlayedEl = $("profileMatchesPlayed");
    if (matchesPlayedEl) matchesPlayedEl.textContent = String(profile.matchesPlayed || 0);

    const winRateEl = $("profileWinRate");
    if (winRateEl) winRateEl.textContent = `${profile.winRate || 0}%`;

    const streakEl = $("profileStreak");
    if (streakEl) streakEl.textContent = `${profile.currentStreak || 0} (Best: ${profile.bestStreak || 0})`;

    const peakSpeedEl = $("profilePeakSpeed");
    if (peakSpeedEl) peakSpeedEl.textContent = `${profile.peakSpeed || 0} px/s`;

    const smashCountEl = $("profileSmashCount");
    if (smashCountEl) smashCountEl.textContent = String(profile.smashCount || 0);

    const curveCountEl = $("profileCurveCount");
    if (curveCountEl) curveCountEl.textContent = String(profile.curveCount || 0);

    const counterCountEl = $("profileCounterCount");
    if (counterCountEl) counterCountEl.textContent = String(profile.counterCount || 0);

    const driveCountEl = $("profileDriveCount");
    if (driveCountEl) driveCountEl.textContent = String(profile.driveCount || 0);

    renderAchievements(profile);
    renderMatchHistory(matches);
    renderReplays();
  }

  function renderReplays() {
    const container = $("profileReplaysList");
    if (!container) return;
    const replays = defaultReplayStore.getAll();
    container.innerHTML = "";

    if (!replays || !replays.length) {
      container.innerHTML = `<p class="historyEmpty">No saved replays yet. Play a match to record automatically!</p>`;
      return;
    }

    for (const r of replays) {
      const item = document.createElement("div");
      item.className = "replayCardItem";
      const dateStr = r.startedAt ? new Date(r.startedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
      const winnerStr = r.winner ? (r.winner === "bottom" ? "Victory" : "Defeat") : "Match";
      item.innerHTML = `
        <div class="replayCardMeta">
          <span class="replayCardTitle">${(r.mode || "1v1").toUpperCase()} · ${winnerStr} (${r.duration || 0}s)</span>
          <span class="replayCardSub">${dateStr} · Peak ${r.stats?.peakSpeed || 0} px/s</span>
        </div>
        <div class="replayCardActions">
          <button class="replaySmallBtn watchBtn" type="button">Watch</button>
          <button class="replaySmallBtn downloadBtn" type="button" title="Download JSON">💾</button>
          <button class="replaySmallBtn deleteBtn" type="button" title="Delete">✕</button>
        </div>
      `;

      item.querySelector(".watchBtn")?.addEventListener?.("click", () => {
        closeProfile();
        if (typeof onWatchReplay === "function") {
          onWatchReplay(r);
        }
      });

      item.querySelector(".downloadBtn")?.addEventListener?.("click", () => {
        defaultReplayStore.exportJson(r);
      });

      item.querySelector(".deleteBtn")?.addEventListener?.("click", () => {
        defaultReplayStore.delete(r.id);
        renderReplays();
      });

      container.appendChild(item);
    }
  }

  function renderAchievements(profile) {
    const container = $("profileBadges");
    if (!container) return;
    const achievements = calculateAchievements(profile);
    container.innerHTML = "";

    for (const ach of achievements) {
      const card = document.createElement("div");
      card.className = `achievementCard ${ach.unlocked ? "unlocked" : "locked"}`;
      card.setAttribute("title", ach.desc);
      card.innerHTML = `
        <span class="achievementIcon">${ach.icon}</span>
        <div class="achievementInfo">
          <strong>${ach.title}</strong>
          <small>${ach.desc}</small>
        </div>
        <span class="achievementStatus">${ach.unlocked ? "✓" : "🔒"}</span>
      `;
      container.appendChild(card);
    }
  }

  function renderMatchHistory(matches) {
    const container = $("profileMatchHistory");
    if (!container) return;
    container.innerHTML = "";

    if (!matches || !matches.length) {
      container.innerHTML = `<p class="historyEmpty">No matches recorded yet. Play online to build your match history!</p>`;
      return;
    }

    for (const m of matches) {
      const row = document.createElement("div");
      row.className = `historyRow ${m.won ? "victory" : "defeat"}`;
      const deltaSign = m.ratingDelta > 0 ? `+${m.ratingDelta}` : m.ratingDelta === 0 ? "0" : `${m.ratingDelta}`;
      row.innerHTML = `
        <span class="historyOutcome">${m.won ? "VICTORY" : "DEFEAT"}</span>
        <span class="historyMode">${m.mode}</span>
        <span class="historyReturns">${m.returns || 0} returns</span>
        <span class="historyDuration">${m.duration || 0}s</span>
        <span class="historyDelta ${m.ratingDelta >= 0 ? "gain" : "loss"}">${deltaSign} Elo</span>
      `;
      container.appendChild(row);
    }
  }

  if (profileBtn) {
    profileBtn.addEventListener("click", openProfile);
  }

  const closeBtn = profileModal?.querySelector?.("[data-close-modal]");
  if (closeBtn) {
    closeBtn.addEventListener("click", closeProfile);
  }

  const fileInput = $("replayFileInput");
  if (fileInput?.addEventListener) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const replay = defaultReplayStore.importJson(evt.target.result);
          defaultReplayStore.save(replay);
          renderReplays();
          closeProfile();
          if (typeof onWatchReplay === "function") {
            onWatchReplay(replay);
          }
        } catch (err) {
          alert(`Could not load replay: ${err.message}`);
        }
      };
      reader.readAsText(file);
      fileInput.value = "";
    });
  }

  return {
    init,
    getProfile,
    openProfile,
    closeProfile,
    renderProfile
  };
}
