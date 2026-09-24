import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import { createHttpServer } from "../../server/src/http.js";
import { AnalyticsEventStore } from "../../server/src/analytics/event-store.js";

describe("Analytics HTTP Endpoints", () => {
  let server;
  let port;
  let store;

  beforeEach(async () => {
    store = new AnalyticsEventStore();
    server = createHttpServer({ analyticsStore: store });
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function makeRequest({ path, method = "GET", body = null }) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {}
      };

      let payload = null;
      if (body) {
        payload = JSON.stringify(body);
        options.headers["Content-Type"] = "application/json";
        options.headers["Content-Length"] = Buffer.byteLength(payload);
      }

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });
      req.on("error", reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  it("POST /api/analytics/events ingests a batch of valid events", async () => {
    const res = await makeRequest({
      path: "/api/analytics/events",
      method: "POST",
      body: [
        { name: "app_open", anonymousId: "user_a", sessionId: "sess_1", timestamp: 1000 },
        { name: "first_gameplay_frame", anonymousId: "user_a", sessionId: "sess_1", timestamp: 1500 }
      ]
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.received).toBe(2);
    expect(res.body.accepted).toBe(2);
    expect(store.events.length).toBe(2);
  });

  it("GET /api/analytics/funnel returns computed conversion steps", async () => {
    store.ingest([
      { name: "app_open", anonymousId: "u1", sessionId: "s1" },
      { name: "first_gameplay_frame", anonymousId: "u1", sessionId: "s1" }
    ]);

    const res = await makeRequest({ path: "/api/analytics/funnel" });
    expect(res.status).toBe(200);
    expect(res.body.steps).toBeDefined();
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.uniqueUsersTotal).toBe(1);

    const landing = res.body.steps.find((s) => s.id === "landing");
    expect(landing.uniqueUsers).toBe(1);
  });

  it("GET /api/analytics/summary returns activation and engagement overview", async () => {
    store.ingest([
      { name: "app_open", anonymousId: "u1", sessionId: "s1", timestamp: 1000 },
      { name: "first_gameplay_frame", anonymousId: "u1", sessionId: "s1", timestamp: 1800 },
      { name: "first_input", anonymousId: "u1", sessionId: "s1", timestamp: 2100 },
      { name: "onboarding_started", anonymousId: "u1", sessionId: "s1" },
      { name: "onboarding_completed", anonymousId: "u1", sessionId: "s1" }
    ]);

    const res = await makeRequest({ path: "/api/analytics/summary" });
    expect(res.status).toBe(200);
    expect(res.body.overview.totalUsers).toBe(1);
    expect(res.body.activation.onboardingCompletionRatePct).toBe(100);
    expect(res.body.activation.medianTimeToGameplayMs).toBe(800);
    expect(res.body.activation.medianTimeToFirstInputMs).toBe(1100);
  });
});
