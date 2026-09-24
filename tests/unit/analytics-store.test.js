import { describe, it, expect, beforeEach } from "vitest";
import { AnalyticsEventStore } from "../../server/src/analytics/event-store.js";

describe("AnalyticsEventStore", () => {
  let store;

  beforeEach(() => {
    store = new AnalyticsEventStore({ maxEvents: 100 });
  });

  it("validates and accepts well-formed events", () => {
    const res = store.ingest([
      {
        name: "app_open",
        anonymousId: "anon_1",
        sessionId: "sess_1",
        timestamp: 1000
      },
      {
        name: "first_input",
        anonymousId: "anon_1",
        sessionId: "sess_1",
        timestamp: 1500
      }
    ]);

    expect(res.accepted).toBe(2);
    expect(res.rejected).toBe(0);
    expect(store.events.length).toBe(2);
  });

  it("rejects invalid events without crashing", () => {
    const res = store.ingest([
      null,
      {},
      { name: "missing_ids" },
      { name: "test", anonymousId: "a" }, // missing sessionId
      { name: "", anonymousId: "a", sessionId: "s" }, // empty name
      { name: "valid", anonymousId: "a", sessionId: "s" }
    ]);

    expect(res.accepted).toBe(1);
    expect(res.rejected).toBe(5);
  });

  it("prunes oldest events when exceeding max capacity", () => {
    const tinyStore = new AnalyticsEventStore({ maxEvents: 3 });
    tinyStore.ingest([
      { name: "event_1", anonymousId: "u1", sessionId: "s1" },
      { name: "event_2", anonymousId: "u1", sessionId: "s1" },
      { name: "event_3", anonymousId: "u1", sessionId: "s1" },
      { name: "event_4", anonymousId: "u1", sessionId: "s1" }
    ]);

    expect(tinyStore.events.length).toBe(3);
    expect(tinyStore.events[0].name).toBe("event_2");
    expect(tinyStore.events[2].name).toBe("event_4");
  });

  it("calculates accurate funnel conversion rates", () => {
    // User 1 goes all the way from Landing -> Gameplay -> First Input -> First Return
    store.ingest([
      { name: "app_open", anonymousId: "u1", sessionId: "s1", timestamp: 1000 },
      { name: "first_gameplay_frame", anonymousId: "u1", sessionId: "s1", timestamp: 1200 },
      { name: "first_input", anonymousId: "u1", sessionId: "s1", timestamp: 1400 },
      { name: "first_return", anonymousId: "u1", sessionId: "s1", timestamp: 2000 }
    ]);

    // User 2 reaches gameplay and inputs, but drops off before return
    store.ingest([
      { name: "app_open", anonymousId: "u2", sessionId: "s2", timestamp: 1000 },
      { name: "first_gameplay_frame", anonymousId: "u2", sessionId: "s2", timestamp: 1300 },
      { name: "first_input", anonymousId: "u2", sessionId: "s2", timestamp: 1600 }
    ]);

    // User 3 lands and leaves immediately (bounces)
    store.ingest([
      { name: "app_open", anonymousId: "u3", sessionId: "s3", timestamp: 1000 }
    ]);

    const report = store.getFunnelReport();
    expect(report.uniqueUsersTotal).toBe(3);

    const landingStep = report.steps.find((s) => s.id === "landing");
    const gameplayStep = report.steps.find((s) => s.id === "gameplay_reached");
    const inputStep = report.steps.find((s) => s.id === "first_input");
    const returnStep = report.steps.find((s) => s.id === "first_return");

    expect(landingStep.uniqueUsers).toBe(3);
    expect(landingStep.conversionFromPreviousPct).toBe(100);

    expect(gameplayStep.uniqueUsers).toBe(2);
    expect(gameplayStep.conversionFromPreviousPct).toBe(66.7);
    expect(gameplayStep.overallConversionPct).toBe(66.7);

    expect(inputStep.uniqueUsers).toBe(2);
    expect(inputStep.conversionFromPreviousPct).toBe(100);

    expect(returnStep.uniqueUsers).toBe(1);
    expect(returnStep.conversionFromPreviousPct).toBe(50);
    expect(returnStep.overallConversionPct).toBe(33.3);
  });

  it("calculates summary activation metrics including median time-to-gameplay", () => {
    store.ingest([
      { name: "app_open", anonymousId: "u1", sessionId: "s1", timestamp: 1000 },
      { name: "first_gameplay_frame", anonymousId: "u1", sessionId: "s1", timestamp: 1500 }, // 500ms
      { name: "first_input", anonymousId: "u1", sessionId: "s1", timestamp: 1800 }, // 800ms
      { name: "onboarding_started", anonymousId: "u1", sessionId: "s1" },
      { name: "onboarding_completed", anonymousId: "u1", sessionId: "s1" },
      { name: "skill_shot", anonymousId: "u1", sessionId: "s1", properties: { shotType: "curve" } },
      { name: "skill_shot", anonymousId: "u1", sessionId: "s1", properties: { shotType: "drive" } },
      { name: "match_completed", anonymousId: "u1", sessionId: "s1", properties: { matchNumber: 1 } },

      { name: "app_open", anonymousId: "u2", sessionId: "s2", timestamp: 2000 },
      { name: "first_gameplay_frame", anonymousId: "u2", sessionId: "s2", timestamp: 3500 }, // 1500ms
      { name: "first_input", anonymousId: "u2", sessionId: "s2", timestamp: 4200 } // 2200ms
    ]);

    const summary = store.getSummaryMetrics();
    expect(summary.overview.totalUsers).toBe(2);
    expect(summary.overview.matchesCompleted).toBe(1);
    expect(summary.activation.medianTimeToGameplayMs).toBe(1000); // (500 + 1500)/2 sorted array
    expect(summary.activation.onboardingCompletionRatePct).toBe(100);
    expect(summary.skillShots.curve).toBe(1);
    expect(summary.skillShots.drive).toBe(1);
    expect(summary.skillShots.smash).toBe(0);
  });
});
