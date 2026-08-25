import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const PORT = 19189;
const BASE_URL = `http://127.0.0.1:${PORT}`;
let server;

beforeAll(async () => {
  server = spawn(process.execPath, ["server/src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(PORT), QUICK_MATCH_FALLBACK_MS: "5000" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServer();
});

afterAll(async () => {
  if (!server || server.exitCode !== null) return;
  server.kill();
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
});

describe("quick matchmaking integration", () => {
  test("pairs the first two independent 1v1 clients before AI fallback", async () => {
    const first = await gameClient("first-rally", "session-first");
    const second = await gameClient("second-rally", "session-second");

    first.send({ t: "quick", mode: "1v1" });
    second.send({ t: "quick", mode: "1v1" });
    const [firstJoin, secondJoin] = await Promise.all([
      first.waitFor((message) => message.t === "joined"),
      second.waitFor((message) => message.t === "joined")
    ]);
    await Promise.all([
      first.waitFor((message) => message.t === "matched"),
      second.waitFor((message) => message.t === "matched")
    ]);

    expect(secondJoin.code).toBe(firstJoin.code);
    expect(new Set([firstJoin.team, secondJoin.team])).toEqual(new Set(["top", "bottom"]));
    const directory = await fetch(`${BASE_URL}/rooms.json?offset=0&status=live`).then((response) => response.json());
    expect(directory.rooms).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: firstJoin.code, status: "running", players: 2, maxPlayers: 2 })
    ]));

    first.close();
    second.close();
  });

  test("lets a public-room join become the waiting quick player's opponent", async () => {
    const first = await gameClient("public-first", "session-public-first");
    const second = await gameClient("public-second", "session-public-second");

    first.send({ t: "quick", mode: "1v1" });
    const firstJoin = await first.waitFor((message) => message.t === "joined");
    second.send({ t: "joinRoom", code: firstJoin.code, role: "player" });
    const secondJoin = await second.waitFor((message) => message.t === "joined");
    await Promise.all([
      first.waitFor((message) => message.t === "matched"),
      second.waitFor((message) => message.t === "matched")
    ]);

    expect(secondJoin.code).toBe(firstJoin.code);
    expect(new Set([firstJoin.team, secondJoin.team])).toEqual(new Set(["top", "bottom"]));
    first.close();
    second.close();
  });
});

async function gameClient(name, sessionId) {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}`);
  const messages = [];
  const listeners = new Set();
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const message = JSON.parse(event.data);
    messages.push(message);
    for (const listener of listeners) listener(message);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.send(JSON.stringify({ t: "hello", name, sessionId, protocol: 1 }));
  return {
    close: () => socket.close(),
    send: (message) => socket.send(JSON.stringify(message)),
    waitFor(predicate, timeoutMs = 3000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error("Timed out waiting for a WebSocket message"));
        }, timeoutMs);
        const listener = (message) => {
          if (!predicate(message)) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve(message);
        };
        listeners.add(listener);
      });
    }
  };
}

async function waitForServer() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Test server exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // The server can still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error("Timed out starting the quick-match test server");
}
