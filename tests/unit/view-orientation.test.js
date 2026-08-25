import { describe, expect, test } from "vitest";
import { H } from "../../client/src/core/shared.js";
import { orientSnapshotForPlayer, playerTeamForSnapshot } from "../../client/src/rendering/view-orientation.js";

function snapshot() {
  return {
    misses: { top: 1, bottom: 3 },
    winner: "top",
    players: [
      { slot: 0, team: "bottom", x: 300 },
      { slot: 2, team: "top", x: 700 }
    ],
    balls: [{ id: 1, y: 120, vy: -450 }],
    power: null,
    lastHit: { y: 28 },
    lastPower: null
  };
}

describe("player-relative court orientation", () => {
  test("puts a top-team player and their misses at the bottom", () => {
    const playerState = { online: true, role: "player", slot: 2, team: "bottom" };

    const view = orientSnapshotForPlayer(snapshot(), playerState);

    expect(playerTeamForSnapshot(snapshot(), playerState)).toBe("top");
    expect(view.players.find((player) => player.slot === 2).team).toBe("bottom");
    expect(view.balls[0]).toMatchObject({ y: H - 120, vy: 450 });
    expect(view.misses).toEqual({ top: 3, bottom: 1 });
  });

  test("leaves the bottom-team player's court unchanged", () => {
    const source = snapshot();
    const view = orientSnapshotForPlayer(source, { online: true, role: "player", slot: 0, team: "top" });

    expect(view).toBe(source);
  });

  test("keeps spectators on the shared server orientation", () => {
    const source = snapshot();
    const view = orientSnapshotForPlayer(source, { online: true, role: "spectator", slot: 2, team: "top" });

    expect(view).toBe(source);
  });
});
