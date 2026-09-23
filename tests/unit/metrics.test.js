import { describe, it, expect, beforeEach } from "vitest";
import { MetricsRegistry } from "../../server/src/metrics.js";

describe("MetricsRegistry & Prometheus Exposition", () => {
  let registry;

  beforeEach(() => {
    registry = new MetricsRegistry();
  });

  it("accurately computes percentiles with rolling reservoir", () => {
    // Record values 1 to 100
    for (let i = 1; i <= 100; i++) {
      registry.recordTickDuration(i);
    }

    const stats = registry.tickDurationMs.getStats();
    expect(stats.count).toBe(100);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(100);
    expect(stats.avg).toBe(50.5);
    // p50 should be around 50, p95 around 95, p99 around 99
    expect(stats.p50).toBeGreaterThanOrEqual(49);
    expect(stats.p50).toBeLessThanOrEqual(51);
    expect(stats.p95).toBeGreaterThanOrEqual(94);
    expect(stats.p95).toBeLessThanOrEqual(96);
    expect(stats.p99).toBeGreaterThanOrEqual(98);
    expect(stats.p99).toBeLessThanOrEqual(100);
  });

  it("updates and snapshots gauges and counters correctly", () => {
    registry.setConnectedClients(42);
    registry.setActiveRooms(8, { waiting: 2, countdown: 1, running: 4, ended: 1 });
    registry.setMatchmakerQueue(5);
    registry.setWorkerCapacity(8, 50);
    registry.recordMessage("binary", "in", 100);
    registry.recordMessage("binary", "out", 200);
    registry.recordMessage("text", "in", 10);
    registry.recordMessage("text", "out", 15);
    registry.incrementMatchCompleted();

    const snapshot = registry.getSnapshot();
    expect(snapshot.connections.connectedClients).toBe(42);
    expect(snapshot.rooms.activeRooms).toBe(8);
    expect(snapshot.rooms.byStatus.running).toBe(4);
    expect(snapshot.rooms.workerCapacityRatio).toBe(0.16);
    expect(snapshot.matchmaker.queueLength).toBe(5);
    expect(snapshot.traffic.messages["binary:in"]).toBe(100);
    expect(snapshot.traffic.messages["binary:out"]).toBe(200);
    expect(snapshot.traffic.matchesCompleted).toBe(1);
  });

  it("formats valid Prometheus text exposition output", () => {
    registry.setConnectedClients(15);
    registry.setActiveRooms(3, { waiting: 1, countdown: 0, running: 2, ended: 0 });
    registry.recordTickDuration(1.2);
    registry.recordTickDuration(2.4);
    registry.recordClientRtt(15.5);
    registry.recordMatchmakerWait(250);

    const prometheus = registry.formatPrometheus();
    expect(prometheus).toContain("# HELP monorally_connected_clients");
    expect(prometheus).toContain("# TYPE monorally_connected_clients gauge");
    expect(prometheus).toContain("monorally_connected_clients 15");
    expect(prometheus).toContain("monorally_active_rooms 3");
    expect(prometheus).toContain('monorally_rooms_by_status{status="running"} 2');
    expect(prometheus).toContain('monorally_tick_duration_ms{quantile="0.5"}');
    expect(prometheus).toContain('monorally_client_rtt_ms{quantile="0.5"}');
    expect(prometheus).toContain('monorally_matchmaker_wait_duration_ms{quantile="0.5"}');
    expect(prometheus).toContain("monorally_process_resident_memory_bytes");
    expect(prometheus).toContain("monorally_process_heap_used_bytes");
  });

  it("computes per-room and per-client memory estimates without dividing by zero", () => {
    registry.setActiveRooms(0);
    registry.setConnectedClients(0);
    const profile = registry.getMemoryProfile();
    expect(profile.estimatedBytesPerRoom).toBe(0);
    expect(profile.estimatedBytesPerClient).toBe(0);

    registry.setActiveRooms(10);
    registry.setConnectedClients(20);
    const activeProfile = registry.getMemoryProfile();
    expect(activeProfile.estimatedBytesPerRoom).toBeGreaterThan(0);
    expect(activeProfile.estimatedBytesPerClient).toBeGreaterThan(0);
  });
});
