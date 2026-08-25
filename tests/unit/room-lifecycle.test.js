import { describe, expect, test } from "vitest";
import { canReplayRoom } from "../../server/src/room-lifecycle.js";

function endedRoom(players) {
  return { status: "ended", maxPlayers: 2, players };
}

describe("replay eligibility", () => {
  test("requires every human player to remain connected", () => {
    const clients = new Map([["one", {}], ["two", {}]]);
    const room = endedRoom([
      { clientId: "one", disconnected: false, bot: false },
      { clientId: "two", disconnected: false, bot: false }
    ]);

    expect(canReplayRoom(room, clients)).toBe(true);
    clients.delete("two");
    expect(canReplayRoom(room, clients)).toBe(false);
  });

  test("keeps replay available when the remaining seats are AI", () => {
    const clients = new Map([["one", {}]]);
    const room = endedRoom([
      { clientId: "one", disconnected: false, bot: false },
      { id: "bot-1", disconnected: false, bot: true }
    ]);

    expect(canReplayRoom(room, clients)).toBe(true);
  });
});
