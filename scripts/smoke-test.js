const baseUrl = process.env.SMOKE_BASE_URL || "http://localhost:18787";
const wsUrl = baseUrl.replace(/^http/, "ws");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeClient(name, protocol = 2, sessionId = "") {
  const ws = new WebSocket(wsUrl);
  const client = {
    ws,
    name,
    protocol,
    events: [],
    binary: 0,
    jsonStates: 0,
    code: null,
    joined: false,
    error: null
  };

  ws.onmessage = (event) => {
    if (typeof event.data === "string") {
      const msg = JSON.parse(event.data);
      client.events.push(msg.t);
      if (msg.t === "roomCreated") client.code = msg.code;
      if (msg.t === "matched") client.code = msg.code;
      if (msg.t === "joined") client.joined = true;
      if (msg.t === "state") client.jsonStates += 1;
      if (msg.t === "error") client.error = msg.message;
      return;
    }
    client.binary += 1;
  };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`connect timeout: ${name}`)), 4000);
    ws.onopen = () => {
      clearTimeout(timeout);
      ws.send(JSON.stringify({ t: "hello", name, protocol, sessionId }));
      resolve(client);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`connect error: ${name}`));
    };
  });
}

function closeAll(clients) {
  for (const client of clients) {
    try {
      client.ws.close();
    } catch {
      // Ignore already-closed smoke clients.
    }
  }
}

async function assertConfig() {
  const res = await fetch(`${baseUrl}/config.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`/config.json returned ${res.status}`);
  return res.json();
}

async function testNewProtocol1v1() {
  const clients = [];
  try {
    const a = await makeClient("smoke-a", 2);
    clients.push(a);
    a.ws.send(JSON.stringify({ t: "createRoom", mode: "1v1" }));
    await wait(250);
    if (!a.code || !a.joined) throw new Error("1v1 creator did not join");

    const b = await makeClient("smoke-b", 2);
    clients.push(b);
    b.ws.send(JSON.stringify({ t: "joinRoom", code: a.code, role: "player" }));
    await wait(700);
    if (!b.joined || a.binary < 3 || b.binary < 3) {
      throw new Error(`1v1 binary state failed: a=${a.binary} b=${b.binary} bJoined=${b.joined}`);
    }
    a.ws.send(JSON.stringify({ t: "replayRoom" }));
    await wait(250);
    if (a.error !== "Replay is available after game over") {
      throw new Error(`running replay guard failed: ${a.error || "no error"}`);
    }
  } finally {
    closeAll(clients);
  }
}

async function testLegacyJsonCompatibility() {
  const clients = [];
  try {
    const a = await makeClient("legacy-a", 1);
    const b = await makeClient("legacy-b", 1);
    clients.push(a, b);
    a.ws.send(JSON.stringify({ t: "quick" }));
    b.ws.send(JSON.stringify({ t: "quick" }));
    await wait(700);
    if (a.binary || b.binary || a.jsonStates < 2 || b.jsonStates < 2) {
      throw new Error(`legacy fallback failed: aJson=${a.jsonStates} bJson=${b.jsonStates} aBin=${a.binary} bBin=${b.binary}`);
    }
  } finally {
    closeAll(clients);
  }
}

async function testQuick2v2AiFill(fallbackMs) {
  const clients = [];
  try {
    const solo = await makeClient("quick-2v2-solo", 2, "quick-2v2-solo-session");
    clients.push(solo);
    solo.ws.send(JSON.stringify({ t: "quick", mode: "2v2" }));
    await wait(fallbackMs + 1400);
    if (!solo.joined || !solo.code || solo.binary < 2) {
      throw new Error(`2v2 quick AI fill failed: joined=${solo.joined} code=${solo.code || "none"} binary=${solo.binary}`);
    }
  } finally {
    closeAll(clients);
  }
}

async function testRoom2v2AiFill() {
  const clients = [];
  try {
    const host = await makeClient("room-fill-host", 2, "room-fill-host-session");
    clients.push(host);
    host.ws.send(JSON.stringify({ t: "createRoom", mode: "2v2" }));
    await wait(300);
    if (!host.code || !host.joined) throw new Error("2v2 fill host did not create room");
    host.ws.send(JSON.stringify({ t: "selectSlot", slot: 0 }));
    host.ws.send(JSON.stringify({ t: "fillAi" }));
    await wait(700);
    if (host.binary < 2) throw new Error(`2v2 room AI fill did not start: binary=${host.binary}`);
  } finally {
    closeAll(clients);
  }
}

async function test2v2AndSpectators(maxSpectators) {
  const clients = [];
  try {
    const sessions = ["session-host", "session-player-1", "session-player-2", "session-player-3"];
    const host = await makeClient("host", 2, sessions[0]);
    clients.push(host);
    host.ws.send(JSON.stringify({ t: "createRoom", mode: "2v2" }));
    await wait(250);
    if (!host.code) throw new Error("2v2 host did not create room");

    for (let i = 0; i < 3; i += 1) {
      const player = await makeClient(`player-${i}`, 2, sessions[i + 1]);
      clients.push(player);
      player.ws.send(JSON.stringify({ t: "joinRoom", code: host.code, role: "player" }));
    }
    await wait(500);
    const players = clients.slice(1, 4);
    if (players.some((client) => !client.joined)) {
      throw new Error("2v2 players did not all join");
    }
    clients.slice(0, 4).forEach((client, slot) => {
      client.ws.send(JSON.stringify({ t: "selectSlot", slot }));
    });
    await wait(900);
    if (clients.slice(0, 4).some((client) => client.binary < 2)) {
      throw new Error("2v2 players did not all receive binary state after slot staging");
    }

    clients[1].ws.close();
    await wait(300);
    const resumed = await makeClient("player-0-return", 2, sessions[1]);
    clients.push(resumed);
    resumed.ws.send(JSON.stringify({ t: "resumeRoom", code: host.code }));
    await wait(700);
    if (!resumed.joined || resumed.binary < 1) {
      throw new Error(`2v2 resume failed: joined=${resumed.joined} binary=${resumed.binary} error=${resumed.error || "none"}`);
    }

    const spectators = [];
    for (let i = 0; i < maxSpectators; i += 1) {
      const spectator = await makeClient(`spectator-${i}`, 2);
      clients.push(spectator);
      spectators.push(spectator);
      spectator.ws.send(JSON.stringify({ t: "joinRoom", code: host.code, role: "spectator" }));
    }
    const overflow = await makeClient("spectator-overflow", 2);
    clients.push(overflow);
    overflow.ws.send(JSON.stringify({ t: "joinRoom", code: host.code, role: "spectator" }));
    await wait(700);
    if (spectators.some((client) => !client.joined) || overflow.error !== "Spectator limit reached") {
      throw new Error("spectator capacity behavior failed");
    }
  } finally {
    closeAll(clients);
  }
}

async function main() {
  const config = await assertConfig();
  await testNewProtocol1v1();
  await testLegacyJsonCompatibility();
  await testQuick2v2AiFill(Number(config.quickMatchFallbackMs) || 5000);
  await testRoom2v2AiFill();
  await test2v2AndSpectators(Number(config.maxSpectators) || 10);
  console.log("smoke_ok config + 1v1 + legacy + quick-ai + room-ai-fill + 2v2 + spectators");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
