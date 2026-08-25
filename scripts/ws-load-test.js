const url = process.env.WS_LOAD_URL || "ws://127.0.0.1:18787";
const clientCount = Math.max(2, Number(process.env.WS_LOAD_CLIENTS) || 200);
const durationMs = Math.max(1000, Number(process.env.WS_LOAD_DURATION_SECONDS || 10) * 1000);
const createMatches = process.env.WS_LOAD_SCENARIO !== "lobby";
const sockets = [];
let binaryMessages = 0;
let closedEarly = 0;
let textMessages = 0;

const startedAt = performance.now();
const results = await Promise.allSettled(
  Array.from({ length: clientCount }, (_, index) => openClient(index))
);
const connected = results.filter((result) => result.status === "fulfilled").length;
const connectFailures = clientCount - connected;

await wait(durationMs);
const memory = process.memoryUsage();
for (const socket of sockets) socket.close(1000, "load test complete");

console.log(
  JSON.stringify(
    {
      url,
      scenario: createMatches ? "quick-1v1" : "lobby",
      requestedClients: clientCount,
      connected,
      connectFailures,
      closedEarly,
      connectMs: Math.round(performance.now() - startedAt - durationMs),
      durationSeconds: durationMs / 1000,
      binaryMessages,
      textMessages,
      runnerMemoryMb: Math.round(memory.rss / 1024 / 1024)
    },
    null,
    2
  )
);

if (connectFailures || closedEarly) process.exitCode = 1;

function openClient(index) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    sockets.push(socket);
    const timeout = setTimeout(() => reject(new Error("connection timeout")), 10000);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("open", () => {
      clearTimeout(timeout);
      socket.send(JSON.stringify({ t: "hello", name: `load-${index}`, protocol: 4, sessionId: `load-session-${index}` }));
      if (createMatches) socket.send(JSON.stringify({ t: "quick", mode: "1v1" }));
      resolve();
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") textMessages += 1;
      else binaryMessages += 1;
    });
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      if (event.code !== 1000) closedEarly += 1;
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("connection error"));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
