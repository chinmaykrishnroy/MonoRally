/**
 * MonoRally Replay HUD Controller
 * Manages draggable/detachable controls, minimize mode, safe-viewport clearance,
 * and auto-fading during replay playback.
 */

export class ReplayHudController {
  constructor({
    hudEl,
    controlsEl,
    dragHandleEl,
    minimizeBtn,
    dockBtn,
    courtEl,
    replayPlayer
  }) {
    this.hudEl = hudEl;
    this.controlsEl = controlsEl;
    this.dragHandleEl = dragHandleEl;
    this.minimizeBtn = minimizeBtn;
    this.dockBtn = dockBtn;
    this.courtEl = courtEl;
    this.replayPlayer = replayPlayer;

    this.isDragging = false;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isDetached = false;
    this.isMinimized = false;
    this.idleTimer = null;
    this.isControlsHidden = false;

    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.init();
  }

  init() {
    if (this.dragHandleEl) {
      this.dragHandleEl.addEventListener("pointerdown", (e) => this.onPointerDown(e));
      this.dragHandleEl.addEventListener("dblclick", () => this.resetDock());
    }

    if (this.controlsEl) {
      this.controlsEl.addEventListener("pointerdown", (e) => {
        // Allow dragging from toolbar background, but ignore interactive controls
        const interactive = e.target.closest("button, input, select, a, [role='button'], .replaySpeedGroup");
        if (!interactive) {
          this.onPointerDown(e);
        }
      });
    }

    if (this.minimizeBtn) {
      this.minimizeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMinimize();
      });
    }

    if (this.dockBtn) {
      this.dockBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.resetDock();
      });
    }

    // Auto-fade management on user activity
    if (typeof window !== "undefined") {
      const onActivity = () => this.onUserActivity();
      window.addEventListener("pointermove", onActivity, { passive: true });
      window.addEventListener("keydown", onActivity, { passive: true });
      window.addEventListener("resize", () => {
        if (this.isDetached) {
          this.clampToViewport();
        }
      });
    }

    if (this.controlsEl) {
      this.controlsEl.addEventListener("pointerenter", () => this.clearIdleFade());
      this.controlsEl.addEventListener("pointerleave", () => {
        if (this.replayPlayer?.status === "playing") {
          this.scheduleIdleFade();
        }
      });
    }

    // Tap/click on court canvas to toggle HUD visibility
    if (this.courtEl) {
      this.courtEl.addEventListener("click", () => {
        const isReplaying = typeof document !== "undefined" && document.body?.classList?.contains("is-replaying");
        if (isReplaying && !this.isDragging) {
          this.toggleControlsVisibility();
        }
      });
    }

    // Subscribe to player state changes for auto-fade
    if (this.replayPlayer) {
      this.replayPlayer.subscribe((info) => {
        if (info.status === "playing") {
          this.scheduleIdleFade();
        } else {
          this.clearIdleFade();
        }
      });
    }
  }

  onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    if (!this.controlsEl) return;

    this.isDragging = true;
    this.clearIdleFade();

    const rect = this.controlsEl.getBoundingClientRect();
    this.offsetX = e.clientX - rect.left;
    this.offsetY = e.clientY - rect.top;

    this.controlsEl.classList.add("is-dragging");
    try {
      this.controlsEl.setPointerCapture(e.pointerId);
    } catch {}

    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", this.boundPointerMove);
      window.addEventListener("pointerup", this.boundPointerUp);
      window.addEventListener("pointercancel", this.boundPointerUp);
    }
  }

  onPointerMove(e) {
    if (!this.isDragging || !this.controlsEl) return;

    const rect = this.controlsEl.getBoundingClientRect();
    const newLeft = e.clientX - this.offsetX;
    const newTop = e.clientY - this.offsetY;

    const winWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
    const winHeight = typeof window !== "undefined" ? window.innerHeight : 1080;
    const minX = 8;
    const maxX = Math.max(minX, winWidth - rect.width - 8);
    const minY = 8;
    const maxY = Math.max(minY, winHeight - rect.height - 8);

    const clampedX = Math.max(minX, Math.min(newLeft, maxX));
    const clampedY = Math.max(minY, Math.min(newTop, maxY));

    this.controlsEl.style.position = "fixed";
    this.controlsEl.style.left = `${clampedX}px`;
    this.controlsEl.style.top = `${clampedY}px`;
    this.controlsEl.style.bottom = "auto";
    this.controlsEl.style.right = "auto";
    this.controlsEl.style.transform = "none";

    this.isDetached = true;
    this.controlsEl.classList.add("is-detached");
    if (this.dockBtn) this.dockBtn.classList.remove("hidden");
  }

  onPointerUp(e) {
    if (!this.isDragging) return;
    this.isDragging = false;

    if (this.controlsEl) {
      this.controlsEl.classList.remove("is-dragging");
      try {
        this.controlsEl.releasePointerCapture(e.pointerId);
      } catch {}
    }

    if (typeof window !== "undefined") {
      window.removeEventListener("pointermove", this.boundPointerMove);
      window.removeEventListener("pointerup", this.boundPointerUp);
      window.removeEventListener("pointercancel", this.boundPointerUp);
    }

    if (this.isDetached && this.controlsEl) {
      const rect = this.controlsEl.getBoundingClientRect();
      try {
        sessionStorage.setItem("monorally_replay_ctrl_pos", JSON.stringify({ x: Math.round(rect.left), y: Math.round(rect.top) }));
      } catch {}
    }

    if (this.replayPlayer?.status === "playing") {
      this.scheduleIdleFade();
    }
  }

  resetDock() {
    if (!this.controlsEl) return;
    this.controlsEl.style.position = "";
    this.controlsEl.style.left = "";
    this.controlsEl.style.top = "";
    this.controlsEl.style.bottom = "";
    this.controlsEl.style.right = "";
    this.controlsEl.style.transform = "";
    this.isDetached = false;
    this.controlsEl.classList.remove("is-detached");
    if (this.dockBtn) this.dockBtn.classList.add("hidden");
    try {
      sessionStorage.removeItem("monorally_replay_ctrl_pos");
    } catch {}
  }

  toggleMinimize() {
    if (!this.controlsEl) return;
    this.isMinimized = !this.isMinimized;
    this.controlsEl.classList.toggle("minimized", this.isMinimized);

    if (this.minimizeBtn) {
      this.minimizeBtn.textContent = this.isMinimized ? "⤒" : "⤓";
      this.minimizeBtn.title = this.isMinimized ? "Expand replay controls" : "Minimize replay controls";
      this.minimizeBtn.setAttribute("aria-label", this.minimizeBtn.title);
    }

    if (this.isDetached) {
      this.clampToViewport();
    }
  }

  clampToViewport() {
    if (!this.isDetached || !this.controlsEl) return;
    const rect = this.controlsEl.getBoundingClientRect();
    const winWidth = typeof window !== "undefined" ? window.innerWidth : 1920;
    const winHeight = typeof window !== "undefined" ? window.innerHeight : 1080;
    const minX = 8;
    const maxX = Math.max(minX, winWidth - rect.width - 8);
    const minY = 8;
    const maxY = Math.max(minY, winHeight - rect.height - 8);

    const clampedX = Math.max(minX, Math.min(rect.left, maxX));
    const clampedY = Math.max(minY, Math.min(rect.top, maxY));

    this.controlsEl.style.left = `${clampedX}px`;
    this.controlsEl.style.top = `${clampedY}px`;
  }

  restoreSavedPosition() {
    if (!this.controlsEl) return;
    try {
      const saved = sessionStorage.getItem("monorally_replay_ctrl_pos");
      if (!saved) return;
      const { x, y } = JSON.parse(saved);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        this.controlsEl.style.position = "fixed";
        this.controlsEl.style.left = `${x}px`;
        this.controlsEl.style.top = `${y}px`;
        this.controlsEl.style.bottom = "auto";
        this.controlsEl.style.right = "auto";
        this.controlsEl.style.transform = "none";
        this.isDetached = true;
        this.controlsEl.classList.add("is-detached");
        if (this.dockBtn) this.dockBtn.classList.remove("hidden");
        this.clampToViewport();
      }
    } catch {}
  }

  scheduleIdleFade() {
    this.clearIdleFade();
    if (!document.body.classList.contains("is-replaying")) return;
    if (this.replayPlayer?.status !== "playing") return;

    this.idleTimer = setTimeout(() => {
      if (this.replayPlayer?.status === "playing" && !this.isDragging) {
        this.hudEl?.classList.add("idle-faded");
      }
    }, 2500);
  }

  clearIdleFade() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.hudEl?.classList.remove("idle-faded");
  }

  onUserActivity() {
    this.clearIdleFade();
    if (this.replayPlayer?.status === "playing") {
      this.scheduleIdleFade();
    }
  }

  toggleControlsVisibility() {
    this.isControlsHidden = !this.isControlsHidden;
    this.hudEl?.classList.toggle("controls-hidden", this.isControlsHidden);
  }

  onEnterReplay() {
    this.isControlsHidden = false;
    this.hudEl?.classList.remove("controls-hidden", "idle-faded");
    this.restoreSavedPosition();
    if (this.replayPlayer?.status === "playing") {
      this.scheduleIdleFade();
    }
  }

  onExitReplay() {
    this.clearIdleFade();
    this.hudEl?.classList.remove("controls-hidden", "idle-faded");
  }
}
