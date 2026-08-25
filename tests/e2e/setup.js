import { spawn } from "node:child_process";
import { once } from "node:events";

const URL = "http://127.0.0.1:19087";

export default async function setup() {
  if (await serverReady()) return undefined;

  const child = spawn(process.execPath, ["server/src/index.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "19087", QUICK_MATCH_FALLBACK_MS: "5000" },
    stdio: "ignore",
    windowsHide: true
  });
  await waitForServer(child);

  return async () => {
    if (child.exitCode !== null) return;
    child.kill("SIGTERM");
    await Promise.race([
      once(child, "exit"),
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  };
}

async function waitForServer(child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`MonoRally test server exited with code ${child.exitCode}`);
    if (await serverReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill("SIGKILL");
  throw new Error("Timed out starting the MonoRally test server");
}

async function serverReady() {
  try {
    const response = await fetch(URL, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}
