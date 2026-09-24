import { describe, it, expect, beforeEach } from "vitest";
import { ProductAnalyticsTracker, ANON_ID_KEY, ACTIVATED_KEY, FIRST_EVENTS_KEY } from "../../client/src/analytics/tracker.js";

class MockStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, val) {
    this.store.set(key, String(val));
  }
  removeItem(key) {
    this.store.delete(key);
  }
}

describe("ProductAnalyticsTracker", () => {
  let mockStorage;
  let sentBatches;
  let tracker;

  beforeEach(() => {
    mockStorage = new MockStorage();
    sentBatches = [];
    tracker = new ProductAnalyticsTracker({
      storage: mockStorage,
      sessionStorage: mockStorage,
      flushIntervalMs: 60000,
      maxBatchSize: 3,
      transport: (batch) => sentBatches.push(batch)
    });
  });

  it("generates and persists anonymous and session identifiers", () => {
    expect(tracker.anonymousId).toMatch(/^anon_/);
    expect(tracker.sessionId).toMatch(/^sess_/);
    expect(mockStorage.getItem(ANON_ID_KEY)).toBe(tracker.anonymousId);
  });

  it("correctly distinguishes new vs returning players", () => {
    expect(tracker.isNewPlayer()).toBe(true);

    tracker.markActivated();
    expect(tracker.isNewPlayer()).toBe(false);
    expect(mockStorage.getItem(ACTIVATED_KEY)).toBe("true");
  });

  it("buffers events and flushes when batch limit is reached", () => {
    tracker.track("app_open");
    tracker.track("play_clicked");
    expect(sentBatches.length).toBe(0);

    tracker.track("first_gameplay_frame"); // Reaches maxBatchSize 3
    expect(sentBatches.length).toBe(1);
    expect(sentBatches[0].length).toBe(3);
    expect(sentBatches[0][0].name).toBe("app_open");
    expect(sentBatches[0][0].dimensions.newOrReturning).toBe("new");
    expect(sentBatches[0][0].dimensions.experimentAssignments).toBeDefined();
  });

  it("tracks lifetime first-time events exactly once", () => {
    tracker.trackFirst("first_input", { key: "ArrowLeft" });
    tracker.trackFirst("first_input", { key: "ArrowRight" });

    tracker.flush();
    expect(sentBatches.length).toBe(1);
    expect(sentBatches[0].length).toBe(1);
    expect(sentBatches[0][0].name).toBe("first_input");
    expect(sentBatches[0][0].properties.key).toBe("ArrowLeft");

    // Verified in mockStorage
    const stored = JSON.parse(mockStorage.getItem(FIRST_EVENTS_KEY));
    expect(stored).toContain("first_input");
  });

  it("increments match numbers across session", () => {
    tracker.track("match_started", { mode: "1v1" });
    tracker.track("match_completed", { winner: "bottom" });

    tracker.track("match_started", { mode: "1v1" }); // triggers auto-flush of batch 1 (3 items)
    tracker.track("match_completed", { winner: "top" });
    tracker.flush();

    expect(sentBatches.length).toBe(2);
    expect(sentBatches[0][0].properties.matchNumber).toBe(1);
    expect(sentBatches[0][1].properties.matchNumber).toBe(1);
    expect(sentBatches[0][2].properties.matchNumber).toBe(2);
    expect(sentBatches[1][0].properties.matchNumber).toBe(2);
  });
});
