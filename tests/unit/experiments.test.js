import { describe, it, expect, beforeEach } from "vitest";
import { getExperimentVariant, getAllExperimentAssignments, EXPERIMENTS_STORAGE_KEY } from "../../client/src/analytics/experiments.js";

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
  clear() {
    this.store.clear();
  }
}

describe("Client Experimentation Framework", () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = new MockStorage();
  });

  it("returns deterministic variant assignment based on anonymousId", () => {
    const v1 = getExperimentVariant("first_time_entry", {
      anonymousId: "user_alpha_123",
      storage: mockStorage
    });
    const v2 = getExperimentVariant("first_time_entry", {
      anonymousId: "user_alpha_123",
      storage: mockStorage
    });

    expect(v1).toBe(v2);
    expect(["direct_session_zero", "standard_menu"]).toContain(v1);
  });

  it("persists variant to storage so it remains stable even if logic changes", () => {
    mockStorage.setItem(
      EXPERIMENTS_STORAGE_KEY,
      JSON.stringify({ first_time_entry: "standard_menu" })
    );

    const variant = getExperimentVariant("first_time_entry", {
      anonymousId: "any_random_id",
      storage: mockStorage
    });

    expect(variant).toBe("standard_menu");
  });

  it("respects URL search query override", () => {
    const variant = getExperimentVariant("first_time_entry", {
      anonymousId: "user_xyz",
      storage: mockStorage,
      search: "?exp_first_time_entry=direct_session_zero"
    });

    expect(variant).toBe("direct_session_zero");
  });

  it("returns all active experiment assignments", () => {
    const assignments = getAllExperimentAssignments({
      anonymousId: "test_visitor_88",
      storage: mockStorage
    });

    expect(assignments.first_time_entry).toBeDefined();
    expect(assignments.onboarding_guidance).toBeDefined();
  });
});
