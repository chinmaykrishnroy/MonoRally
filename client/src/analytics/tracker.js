/**
 * First-party product analytics collector.
 * Privacy-preserving: strictly pseudonymous, no third-party scripts or cookies.
 */

import { config } from "../core/shared.js";
import { getAllExperimentAssignments } from "./experiments.js";

export const ANON_ID_KEY = "monorally_anon_id";
export const SESSION_ID_KEY = "monorally_session_id";
export const ACTIVATED_KEY = "monorally_activated";
export const MATCHES_PLAYED_KEY = "monorally_matches_played";
export const FIRST_EVENTS_KEY = "monorally_first_events_v1";

export class ProductAnalyticsTracker {
  constructor({
    endpoint = "/api/analytics/events",
    flushIntervalMs = 5000,
    maxBatchSize = 20,
    storage = typeof localStorage !== "undefined" ? localStorage : null,
    sessionStorage = typeof window !== "undefined" && window.sessionStorage ? window.sessionStorage : null,
    transport = null
  } = {}) {
    this.endpoint = endpoint;
    this.flushIntervalMs = flushIntervalMs;
    this.maxBatchSize = maxBatchSize;
    this.storage = storage;
    this.sessionStorage = sessionStorage;
    this.transport = transport; // Custom transport for unit tests

    this.queue = [];
    this.timer = null;
    this.inputMethod = "touch";
    this.sessionMatchCount = 0;

    this.anonymousId = this.getOrCreateAnonymousId();
    this.sessionId = this.getOrCreateSessionId();
    this.firstEvents = this.loadFirstEvents();

    this.setupAutoFlush();
  }

  getOrCreateAnonymousId() {
    if (this.storage) {
      try {
        const stored = this.storage.getItem(ANON_ID_KEY);
        if (stored) return stored;
        const generated = generateId("anon");
        this.storage.setItem(ANON_ID_KEY, generated);
        return generated;
      } catch {
        // fallback
      }
    }
    return generateId("anon");
  }

  getOrCreateSessionId() {
    if (this.sessionStorage) {
      try {
        const stored = this.sessionStorage.getItem(SESSION_ID_KEY);
        if (stored) return stored;
        const generated = generateId("sess");
        this.sessionStorage.setItem(SESSION_ID_KEY, generated);
        return generated;
      } catch {
        // fallback
      }
    }
    return generateId("sess");
  }

  loadFirstEvents() {
    if (this.storage) {
      try {
        const raw = this.storage.getItem(FIRST_EVENTS_KEY);
        if (raw) return new Set(JSON.parse(raw));
      } catch {
        // fallback
      }
    }
    return new Set();
  }

  saveFirstEvents() {
    if (this.storage) {
      try {
        this.storage.setItem(FIRST_EVENTS_KEY, JSON.stringify([...this.firstEvents]));
      } catch {
        // fallback
      }
    }
  }

  isNewPlayer() {
    if (!this.storage) return true;
    try {
      return !this.storage.getItem(ACTIVATED_KEY) && !this.storage.getItem(MATCHES_PLAYED_KEY);
    } catch {
      return true;
    }
  }

  markActivated() {
    if (this.storage) {
      try {
        this.storage.setItem(ACTIVATED_KEY, "true");
      } catch {
        // fallback
      }
    }
  }

  recordMatchCompleted() {
    if (this.storage) {
      try {
        const count = Number(this.storage.getItem(MATCHES_PLAYED_KEY) || 0) + 1;
        this.storage.setItem(MATCHES_PLAYED_KEY, String(count));
      } catch {
        // fallback
      }
    }
  }

  setInputMethod(method) {
    if (["touch", "mouse", "keyboard"].includes(method)) {
      this.inputMethod = method;
    }
  }

  getViewportClass() {
    if (typeof window === "undefined") return "desktop";
    const w = window.innerWidth;
    if (w < 768) return "mobile";
    if (w < 1024) return "tablet";
    return "desktop";
  }

  getPlatform() {
    if (typeof navigator === "undefined") return "desktop";
    const ua = navigator.userAgent || "";
    if (/android|iphone|ipad|ipod/i.test(ua)) return "mobile";
    return "desktop";
  }

  getDimensions() {
    return {
      appVersion: config.appVersion || "1.13.0",
      newOrReturning: this.isNewPlayer() ? "new" : "returning",
      platform: this.getPlatform(),
      viewportClass: this.getViewportClass(),
      inputMethod: this.inputMethod,
      experimentAssignments: getAllExperimentAssignments({
        anonymousId: this.anonymousId,
        storage: this.storage
      })
    };
  }

  /**
   * Track an analytics event.
   * @param {string} name Event name
   * @param {Object} [properties] Event-specific payload
   */
  track(name, properties = {}) {
    if (!name || typeof name !== "string") return;

    if (name === "match_started") {
      this.sessionMatchCount += 1;
      properties = { matchNumber: this.sessionMatchCount, ...properties };
    } else if (name === "match_completed") {
      properties = { matchNumber: this.sessionMatchCount, ...properties };
      this.recordMatchCompleted();
    }

    const event = {
      name: name.trim(),
      anonymousId: this.anonymousId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      properties,
      dimensions: this.getDimensions()
    };

    this.queue.push(event);

    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Track a first-time milestone event once in a user's lifetime.
   * e.g. first_render, first_gameplay_frame, first_input, first_ball_contact, first_return, first_skill_shot
   */
  trackFirst(name, properties = {}) {
    if (this.firstEvents.has(name)) return;
    this.firstEvents.add(name);
    this.saveFirstEvents();
    this.track(name, properties);
  }

  flush() {
    if (!this.queue.length) return;
    const batch = [...this.queue];
    this.queue = [];

    if (this.transport) {
      this.transport(batch);
      return;
    }

    const payload = JSON.stringify(batch);

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      try {
        const blob = new Blob([payload], { type: "application/json" });
        const sent = navigator.sendBeacon(this.endpoint, blob);
        if (sent) return;
      } catch {
        // fallback to fetch
      }
    }

    if (typeof fetch === "function") {
      fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      }).catch(() => {
        // Non-blocking telemetry
      });
    }
  }

  setupAutoFlush() {
    if (typeof window !== "undefined") {
      this.timer = window.setInterval(() => this.flush(), this.flushIntervalMs);

      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          this.track("session_end");
          this.flush();
        }
      });

      window.addEventListener("pagehide", () => this.flush());
      window.addEventListener("beforeunload", () => this.flush());
    }
  }

  destroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }
}

function generateId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export const tracker = new ProductAnalyticsTracker();
