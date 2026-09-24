import { describe, it, expect } from "vitest";
import { MemoryWorkerRegistry } from "../../server/src/redis/worker-registry.js";
import { metrics } from "../../server/src/metrics.js";

describe("Worker Safe Capacity and Autoscaling Metrics", () => {
  it("MemoryWorkerRegistry caps allocation to safe capacity (85% of maxRooms)", async () => {
    const registry = new MemoryWorkerRegistry();

    // Register worker 1 with capacity 50 and 41 active rooms (82% - under safe capacity of Math.floor(50 * 0.85) = 42)
    await registry.registerWorkerHeartbeat({
      workerId: "worker-1",
      activeRooms: 41,
      maxRooms: 50
    });

    // Register worker 2 with capacity 50 and 42 active rooms (84% - at safe capacity of Math.floor(50 * 0.85) = 42)
    await registry.registerWorkerHeartbeat({
      workerId: "worker-2",
      activeRooms: 42,
      maxRooms: 50
    });

    const chosen = await registry.getLeastLoadedWorker(50);
    expect(chosen).not.toBeNull();
    expect(chosen.workerId).toBe("worker-1");

    // Now bump worker-1 to 42 active rooms as well (at safe capacity)
    await registry.registerWorkerHeartbeat({
      workerId: "worker-1",
      activeRooms: 42,
      maxRooms: 50
    });

    const cappedOut = await registry.getLeastLoadedWorker(50);
    expect(cappedOut).toBeNull();
  });

  it("MetricsRegistry records event-loop lag, outbound bytes, and send-buffer pressure", () => {
    metrics.reset();

    metrics.recordOutboundBytes(1024);
    metrics.recordOutboundBytes(512);
    expect(metrics.outboundBytesTotal).toBe(1536);

    metrics.setSendBufferPressure(4096);
    expect(metrics.sendBufferPressureBytes).toBe(4096);

    const snapshot = metrics.getSnapshot();
    expect(snapshot.traffic.outboundBytesTotal).toBe(1536);
    expect(snapshot.traffic.sendBufferPressureBytes).toBe(4096);
    expect(snapshot.latencies.eventLoopLagMs).toBeDefined();
    expect(typeof snapshot.latencies.eventLoopLagMs.p50).toBe("number");

    const prom = metrics.formatPrometheus();
    expect(prom).toContain("monorally_outbound_bytes_total 1536");
    expect(prom).toContain("monorally_send_buffer_pressure_bytes 4096");
    expect(prom).toContain("monorally_event_loop_lag_ms");
  });
});
