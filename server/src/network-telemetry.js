import { DEBUG_NETWORK_TELEMETRY } from "./config.js";

let enabled = DEBUG_NETWORK_TELEMETRY;
let writer = (line) => console.debug(line);

export function emitNetworkTelemetry(event, details = {}) {
  if (!enabled) return;
  const payload = typeof details === "function" ? details() : details;
  writer(JSON.stringify({
    scope: "monorally.network",
    event,
    at: new Date().toISOString(),
    ...payload
  }));
}

export function configureNetworkTelemetryForTests(nextEnabled, nextWriter) {
  enabled = Boolean(nextEnabled);
  writer = typeof nextWriter === "function" ? nextWriter : (line) => console.debug(line);
}
