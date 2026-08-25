import { expect, test, vi } from "vitest";
import { createBroadcasters } from "../../server/src/broadcasting.js";

test("public room pages are capped and continue from their offset", () => {
  const rooms = new Map();
  for (let index = 0; index < 12; index += 1) {
    const code = index.toString(16).toUpperCase().padStart(6, "0");
    rooms.set(code, {
      code,
      maxPlayers: 2,
      mode: "1v1",
      players: [{ clientId: `player-${index}` }],
      quick: false,
      spectators: [],
      status: "waiting",
      visibility: "public"
    });
  }
  const broadcasters = createBroadcasters({
    checkPresenceWin: vi.fn(),
    clients: new Map(),
    rooms,
    stateMechanics: {}
  });

  const first = broadcasters.publicRoomPage({ status: "waiting", offset: 0 });
  const second = broadcasters.publicRoomPage({ status: "waiting", offset: first.nextOffset });

  expect(first.rooms).toHaveLength(10);
  expect(first).toMatchObject({ hasMore: true, nextOffset: 10, total: 12 });
  expect(second.rooms).toHaveLength(2);
  expect(second).toMatchObject({ hasMore: false, nextOffset: 12, total: 12 });
});
