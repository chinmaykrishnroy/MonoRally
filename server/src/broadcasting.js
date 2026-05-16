import { NETWORK_HZ, REJOIN_GRACE_MS } from "./config.js";
import { jsonState, statePacket } from "./serialization.js";
import { broadcast, broadcastBinary } from "./ws.js";

export function createBroadcasters({ checkPresenceWin, clients, rooms, stateMechanics }) {
  function publishState(room, now, force = false) {
    if (!force && now < room.nextPublishAt) return;
    room.nextPublishAt = now + (room.status === "running" ? 1000 / NETWORK_HZ : 500);
    const recipients = [...room.players.map((p) => clients.get(p.clientId)).filter(Boolean), ...room.spectators];
    if (!recipients.length) return;
    const binaryRecipients = recipients.filter((client) => client.protocol >= 2);
    const jsonRecipients = recipients.filter((client) => client.protocol < 2);
    if (binaryRecipients.length) broadcastBinary(binaryRecipients, statePacket(room, now, stateMechanics));
    if (jsonRecipients.length) broadcast(jsonRecipients, jsonState(room, now, stateMechanics));
  }

  function broadcastRoster(room) {
    const recipients = [...room.players.map((p) => clients.get(p.clientId)).filter(Boolean), ...room.spectators];
    if (!recipients.length) return;
    broadcast(recipients, {
      t: "roster",
      room: room.code,
      mode: room.mode,
      players: room.players.filter((p) => !p.disconnected).map((p) => ({
        id: p.clientId || p.id,
        name: p.name,
        team: p.team,
        slot: p.slot
      }))
    });
  }

  function publicRooms() {
    return [...rooms.values()]
      .filter((room) => !room.quick)
      .map((room) => ({
        code: room.code,
        mode: room.mode,
        status: room.status,
        players: room.players.length,
        maxPlayers: room.maxPlayers,
        spectators: room.spectators.length
      }));
  }

  function broadcastRooms() {
    broadcast([...clients.values()].filter((client) => client.role === "lobby" || client.role === "quick"), {
      t: "rooms",
      rooms: publicRooms()
    });
  }

  function pruneRooms() {
    const now = performance.now();
    for (const [code, room] of rooms) {
      const before = room.players.length;
      room.players = room.players.filter((player) => !player.disconnected || now - player.disconnectedAt <= REJOIN_GRACE_MS);
      if (before !== room.players.length && room.status === "running") {
        checkPresenceWin(room);
        broadcastRoster(room);
        publishState(room, now, true);
      }
      if (room.quick && !room.spectators.length && !room.players.some((player) => player.clientId || player.disconnected)) {
        rooms.delete(code);
        continue;
      }
      if (!room.players.length && !room.spectators.length) rooms.delete(code);
      if (room.quick && room.status === "ended" && now - room.lastTick > 15000) rooms.delete(code);
    }
  }

  return { broadcastRooms, broadcastRoster, pruneRooms, publicRooms, publishState };
}
