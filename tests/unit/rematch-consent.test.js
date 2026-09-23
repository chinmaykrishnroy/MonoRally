import { describe, expect, test } from "vitest";
import { evaluateRematchRequest, handlePlayerLeaveRematch } from "../../server/src/rematch.js";

describe("mutual rematch consent engine", () => {
  test("allows immediate rematch when playing solo against bots", () => {
    const room = { status: "ended", code: "TEST01", rematchConsent: new Set() };
    const humanPlayers = [{ clientId: "c1", bot: false, disconnected: false }];

    const res = evaluateRematchRequest(room, "c1", humanPlayers);
    expect(res.ok).toBe(true);
    expect(res.immediate).toBe(true);
  });

  test("requires mutual consent from all human players in a 1v1 matchup", () => {
    const room = { status: "ended", code: "TEST02", rematchConsent: new Set() };
    const humanPlayers = [
      { clientId: "p1", bot: false, disconnected: false },
      { clientId: "p2", bot: false, disconnected: false }
    ];

    // Player 1 requests rematch
    const res1 = evaluateRematchRequest(room, "p1", humanPlayers);
    expect(res1.ok).toBe(true);
    expect(res1.immediate).toBe(false);
    expect(res1.acceptedCount).toBe(1);
    expect(res1.totalNeeded).toBe(2);
    expect(res1.timeLeft).toBe(15);

    // Player 2 accepts rematch
    const res2 = evaluateRematchRequest(room, "p2", humanPlayers);
    expect(res2.ok).toBe(true);
    expect(res2.immediate).toBe(true);
    expect(res2.acceptedCount).toBe(2);
    expect(res2.totalNeeded).toBe(2);
  });

  test("cleans up rematch and notifies declined when a player leaves during active request", () => {
    const room = {
      status: "ended",
      code: "TEST03",
      rematchConsent: new Set(["p1"]),
      rematchTimer: setTimeout(() => {}, 10000)
    };

    const cleanup = handlePlayerLeaveRematch(room, "p1");
    expect(cleanup).toBeTruthy();
    expect(cleanup.declined).toBe(true);
    expect(room.rematchTimer).toBe(null);
    expect(room.rematchConsent.size).toBe(0);
  });

  test("rejects rematch request when match has not ended", () => {
    const room = { status: "running", code: "TEST04", rematchConsent: new Set() };
    const res = evaluateRematchRequest(room, "p1", [{ clientId: "p1", bot: false }]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("after game over");
  });
});
