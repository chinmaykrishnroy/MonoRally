import { describe, it, expect } from "vitest";
import { runScaleBenchmark } from "../../scripts/scale-benchmark.js";

describe("Scale Benchmark Integration", () => {
  it("executes multi-worker synthetic load benchmark and satisfies SLO assertions", async () => {
    const results = await runScaleBenchmark({
      workerCount: 3,
      gatewayCount: 2,
      clientPairs: 4,
      durationSeconds: 1
    });

    expect(results).toBeDefined();
    expect(results.scale.workers).toBe(3);
    expect(results.scale.gateways).toBe(2);
    expect(results.scale.connectedPlayers).toBe(8);
    expect(results.scale.activeRooms).toBeGreaterThanOrEqual(1);

    // Performance SLOs
    expect(results.performance.throughputPacketsSec).toBeGreaterThan(0);
    expect(results.performance.connectLatencyMs.p99).toBeLessThan(100);
    expect(results.performance.tickDurationMs.p99).toBeLessThan(16.6); // 60 Hz physics deadline
    expect(results.performance.tickDurationMs.sloPassed).toBe(true);

    // Memory footprint
    expect(results.resources.heapUsedMb).toBeGreaterThan(0);
    expect(results.resources.bytesPerRoomKb).toBeLessThan(10240); // Under 10 MB per court
  });
});
