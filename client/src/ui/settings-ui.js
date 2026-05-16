import { SETTINGS_KEY, clamp, config, generatedHandle, settings } from "../core/shared.js";

export function createSettingsUi({ elements, state }) {
  const {
    aiDifficulty,
    bottomControlInput,
    infoModal,
    nameInput,
    overlay,
    quick1,
    quick2,
    quickStatus,
    renderDelayInput,
    settingsModal,
    settingsName,
    soundInput
  } = elements;

  async function loadConfig() {
    try {
      const res = await fetch("/config.json", { cache: "no-store" });
      if (!res.ok) return;
      Object.assign(config, await res.json());
      loadSettings();
      state.renderDelay = Number(config.renderDelayMs) || state.renderDelay;
      quickStatus.textContent = `quick match waits ${Math.round(config.quickMatchFallbackMs / 1000)}s, then fills empty seats with ${config.quickAiDifficulty || "medium"} AI`;
    } catch {
      // Defaults are already tuned for local play.
    }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
      if (typeof saved.name === "string") nameInput.value = saved.name;
      if (["easy", "medium", "hard", "insane"].includes(saved.aiDifficulty)) config.aiDifficulty = saved.aiDifficulty;
      if (Number.isFinite(saved.renderDelayMs)) {
        state.renderDelay = clamp(Number(saved.renderDelayMs), 40, 180);
        config.renderDelayMs = state.renderDelay;
      }
      if (typeof saved.bottomHalfControl === "boolean") settings.bottomHalfControl = saved.bottomHalfControl;
      if (typeof saved.sound === "boolean") settings.sound = saved.sound;
    } catch {
      // Corrupt local settings should never block play.
    }
    syncSettingsControls();
  }

  function saveSettings() {
    const payload = {
      name: nameInput.value.trim(),
      aiDifficulty: config.aiDifficulty,
      renderDelayMs: state.renderDelay,
      bottomHalfControl: settings.bottomHalfControl,
      sound: settings.sound
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
    syncSettingsControls();
  }

  function syncSettingsControls() {
    settingsName.value = nameInput.value;
    aiDifficulty.value = config.aiDifficulty;
    renderDelayInput.value = String(state.renderDelay || config.renderDelayMs || 90);
    bottomControlInput.checked = settings.bottomHalfControl;
    soundInput.checked = settings.sound;
  }

  function ensureHandle() {
    const existing = nameInput.value.trim().toLowerCase();
    if (existing) return existing.slice(0, 18);
    const generated = generatedHandle();
    nameInput.value = generated;
    settingsName.value = generated;
    saveSettings();
    return generated;
  }

  function openModal(which) {
    syncSettingsControls();
    overlay.classList.remove("hidden");
    settingsModal.classList.toggle("hidden", which !== "settings");
    infoModal.classList.toggle("hidden", which !== "info");
    document.body.classList.add("modal-open");
    const focusTarget = which === "settings" ? settingsName : infoModal.querySelector("[data-close-modal]");
    requestAnimationFrame(() => focusTarget?.focus?.());
  }

  function closeModal() {
    overlay.classList.add("hidden");
    settingsModal.classList.add("hidden");
    infoModal.classList.add("hidden");
    document.body.classList.remove("modal-open");
  }

  function setQuickMode(mode) {
    state.quickMode = mode === "2v2" ? "2v2" : "1v1";
    quick1.classList.toggle("active", state.quickMode === "1v1");
    quick2.classList.toggle("active", state.quickMode === "2v2");
  }

  return { closeModal, ensureHandle, loadConfig, loadSettings, openModal, saveSettings, setQuickMode, syncSettingsControls };
}
