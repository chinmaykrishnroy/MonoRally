import { monitorEventLoopDelay } from "node:perf_hooks";

/**
 * MonoRally Performance Metrics & Telemetry Registry
 * Lightweight, zero-allocation sliding-window metric collection and Prometheus exposition.
 */

class RollingReservoir {
  constructor(size = 1024) {
    this.size = size;
    this.buffer = new Float64Array(size);
    this.head = 0;
    this.count = 0;
    this.total = 0;
    this.minVal = Infinity;
    this.maxVal = -Infinity;
  }

  record(val) {
    const num = Number(val) || 0;
    this.buffer[this.head] = num;
    this.head = (this.head + 1) % this.size;
    if (this.count < this.size) this.count++;
    this.total += num;
    if (num < this.minVal) this.minVal = num;
    if (num > this.maxVal) this.maxVal = num;
  }

  getPercentile(pct) {
    if (this.count === 0) return 0;
    const samples = Array.from(this.buffer.subarray(0, this.count)).sort((a, b) => a - b);
    const index = Math.min(this.count - 1, Math.max(0, Math.floor(pct * (this.count - 1))));
    return Math.round(samples[index] * 1000) / 1000;
  }

  getStats() {
    if (this.count === 0) {
      return { count: 0, p50: 0, p90: 0, p95: 0, p99: 0, min: 0, max: 0, avg: 0 };
    }
    const samples = Array.from(this.buffer.subarray(0, this.count)).sort((a, b) => a - b);
    const getP = (p) => {
      const idx = Math.min(this.count - 1, Math.max(0, Math.floor(p * (this.count - 1))));
      return Math.round(samples[idx] * 1000) / 1000;
    };
    return {
      count: this.count,
      p50: getP(0.5),
      p90: getP(0.9),
      p95: getP(0.95),
      p99: getP(0.99),
      min: Math.round(this.minVal * 1000) / 1000,
      max: Math.round(this.maxVal * 1000) / 1000,
      avg: Math.round((this.total / this.count) * 1000) / 1000
    };
  }

  reset() {
    this.head = 0;
    this.count = 0;
    this.total = 0;
    this.minVal = Infinity;
    this.maxVal = -Infinity;
  }
}

export class MetricsRegistry {
  constructor() {
    this.eventLoopDelay = typeof monitorEventLoopDelay === "function" ? monitorEventLoopDelay({ resolution: 20 }) : null;
    if (this.eventLoopDelay) {
      this.eventLoopDelay.enable();
    }
    this.reset();
  }

  reset() {
    this.connectedClients = 0;
    this.activeRooms = 0;
    this.roomsByStatus = { waiting: 0, countdown: 0, running: 0, ended: 0 };
    this.matchmakerQueueLength = 0;
    this.workerCapacityRatio = 0;
    this.matchesCompletedTotal = 0;
    this.outboundBytesTotal = 0;
    this.sendBufferPressureBytes = 0;

    this.messages = {
      "binary:in": 0,
      "binary:out": 0,
      "text:in": 0,
      "text:out": 0
    };

    this.tickDurationMs = new RollingReservoir(2048);
    this.clientRttMs = new RollingReservoir(1024);
    this.matchmakerWaitMs = new RollingReservoir(1024);

    this.initialCpu = process.cpuUsage ? process.cpuUsage() : { user: 0, system: 0 };
    if (this.eventLoopDelay && typeof this.eventLoopDelay.reset === "function") {
      this.eventLoopDelay.reset();
    }
  }

  // --- Recording methods ---

  setConnectedClients(count) {
    this.connectedClients = Math.max(0, Number(count) || 0);
  }

  setActiveRooms(count, statusBreakdown = {}) {
    this.activeRooms = Math.max(0, Number(count) || 0);
    if (statusBreakdown) {
      this.roomsByStatus = {
        waiting: statusBreakdown.waiting || 0,
        countdown: statusBreakdown.countdown || 0,
        running: statusBreakdown.running || 0,
        ended: statusBreakdown.ended || 0
      };
    }
  }

  setMatchmakerQueue(count) {
    this.matchmakerQueueLength = Math.max(0, Number(count) || 0);
  }

  setWorkerCapacity(activeRooms, maxRooms) {
    const max = Number(maxRooms) || 1;
    this.workerCapacityRatio = Math.round((activeRooms / max) * 1000) / 1000;
  }

  incrementMatchCompleted() {
    this.matchesCompletedTotal++;
  }

  recordMessage(type = "text", direction = "in", count = 1) {
    const key = `${type}:${direction}`;
    if (key in this.messages) {
      this.messages[key] += count;
    }
  }

  recordTickDuration(durationMs) {
    this.tickDurationMs.record(durationMs);
  }

  recordClientRtt(rttMs) {
    this.clientRttMs.record(rttMs);
  }

  recordMatchmakerWait(waitMs) {
    this.matchmakerWaitMs.record(waitMs);
  }

  recordOutboundBytes(bytes) {
    this.outboundBytesTotal += Math.max(0, Number(bytes) || 0);
  }

  setSendBufferPressure(bytes) {
    this.sendBufferPressureBytes = Math.max(0, Number(bytes) || 0);
  }

  getEventLoopLagStats() {
    if (!this.eventLoopDelay) {
      return { min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0 };
    }
    const toMs = (ns) => Math.round((Number(ns) / 1e6) * 1000) / 1000;
    return {
      min: toMs(this.eventLoopDelay.min),
      max: toMs(this.eventLoopDelay.max),
      mean: toMs(this.eventLoopDelay.mean),
      p50: toMs(this.eventLoopDelay.percentile(50)),
      p90: toMs(this.eventLoopDelay.percentile(90)),
      p99: toMs(this.eventLoopDelay.percentile(99))
    };
  }

  // --- Aggregation & Profiles ---

  getMemoryProfile() {
    const mem = process.memoryUsage ? process.memoryUsage() : { rss: 0, heapTotal: 0, heapUsed: 0, external: 0 };
    const perRoomBytes = this.activeRooms > 0 ? Math.round(mem.heapUsed / this.activeRooms) : 0;
    const perClientBytes = this.connectedClients > 0 ? Math.round(mem.heapUsed / this.connectedClients) : 0;

    return {
      rssBytes: mem.rss,
      heapTotalBytes: mem.heapTotal,
      heapUsedBytes: mem.heapUsed,
      externalBytes: mem.external,
      rssMb: Math.round((mem.rss / (1024 * 1024)) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / (1024 * 1024)) * 10) / 10,
      estimatedBytesPerRoom: perRoomBytes,
      estimatedBytesPerClient: perClientBytes
    };
  }

  getCpuProfile() {
    if (!process.cpuUsage) return { userSeconds: 0, systemSeconds: 0 };
    const usage = process.cpuUsage();
    return {
      userSeconds: Math.round((usage.user / 1e6) * 1000) / 1000,
      systemSeconds: Math.round((usage.system / 1e6) * 1000) / 1000
    };
  }

  getSnapshot() {
    const mem = this.getMemoryProfile();
    const cpu = this.getCpuProfile();
    return {
      timestamp: new Date().toISOString(),
      connections: {
        connectedClients: this.connectedClients
      },
      rooms: {
        activeRooms: this.activeRooms,
        byStatus: { ...this.roomsByStatus },
        workerCapacityRatio: this.workerCapacityRatio
      },
      matchmaker: {
        queueLength: this.matchmakerQueueLength,
        waitDurationMs: this.matchmakerWaitMs.getStats()
      },
      traffic: {
        messages: { ...this.messages },
        outboundBytesTotal: this.outboundBytesTotal,
        sendBufferPressureBytes: this.sendBufferPressureBytes,
        matchesCompleted: this.matchesCompletedTotal
      },
      latencies: {
        tickDurationMs: this.tickDurationMs.getStats(),
        clientRttMs: this.clientRttMs.getStats(),
        eventLoopLagMs: this.getEventLoopLagStats()
      },
      resources: {
        memory: mem,
        cpu
      }
    };
  }

  /**
   * Format metrics using standard Prometheus 0.0.4 text exposition format.
   */
  formatPrometheus() {
    const mem = this.getMemoryProfile();
    const cpu = this.getCpuProfile();
    const tick = this.tickDurationMs.getStats();
    const rtt = this.clientRttMs.getStats();
    const wait = this.matchmakerWaitMs.getStats();

    const lines = [
      "# HELP monorally_connected_clients Current number of active WebSocket client connections.",
      "# TYPE monorally_connected_clients gauge",
      `monorally_connected_clients ${this.connectedClients}`,
      "",
      "# HELP monorally_active_rooms Current number of active game rooms on this instance.",
      "# TYPE monorally_active_rooms gauge",
      `monorally_active_rooms ${this.activeRooms}`,
      "",
      "# HELP monorally_rooms_by_status Number of rooms broken down by lifecycle status.",
      "# TYPE monorally_rooms_by_status gauge",
      `monorally_rooms_by_status{status="waiting"} ${this.roomsByStatus.waiting || 0}`,
      `monorally_rooms_by_status{status="countdown"} ${this.roomsByStatus.countdown || 0}`,
      `monorally_rooms_by_status{status="running"} ${this.roomsByStatus.running || 0}`,
      `monorally_rooms_by_status{status="ended"} ${this.roomsByStatus.ended || 0}`,
      "",
      "# HELP monorally_worker_capacity_ratio Ratio of active rooms to max configured room capacity.",
      "# TYPE monorally_worker_capacity_ratio gauge",
      `monorally_worker_capacity_ratio ${this.workerCapacityRatio}`,
      "",
      "# HELP monorally_matchmaker_queue_length Number of players currently queued in matchmaking.",
      "# TYPE monorally_matchmaker_queue_length gauge",
      `monorally_matchmaker_queue_length ${this.matchmakerQueueLength}`,
      "",
      "# HELP monorally_messages_total Total message counter categorized by packet format and direction.",
      "# TYPE monorally_messages_total counter",
      `monorally_messages_total{type="binary",direction="in"} ${this.messages["binary:in"]}`,
      `monorally_messages_total{type="binary",direction="out"} ${this.messages["binary:out"]}`,
      `monorally_messages_total{type="text",direction="in"} ${this.messages["text:in"]}`,
      `monorally_messages_total{type="text",direction="out"} ${this.messages["text:out"]}`,
      "",
      "# HELP monorally_matches_completed_total Total finished game matches on this node.",
      "# TYPE monorally_matches_completed_total counter",
      `monorally_matches_completed_total ${this.matchesCompletedTotal}`,
      "",
      "# HELP monorally_tick_duration_ms Physics loop tick execution duration in milliseconds.",
      "# TYPE monorally_tick_duration_ms summary",
      `monorally_tick_duration_ms{quantile="0.5"} ${tick.p50}`,
      `monorally_tick_duration_ms{quantile="0.9"} ${tick.p90}`,
      `monorally_tick_duration_ms{quantile="0.95"} ${tick.p95}`,
      `monorally_tick_duration_ms{quantile="0.99"} ${tick.p99}`,
      `monorally_tick_duration_ms{quantile="1.0"} ${tick.max}`,
      `monorally_tick_duration_ms_count ${tick.count}`,
      `monorally_tick_duration_ms_sum ${Math.round(this.tickDurationMs.total * 1000) / 1000}`,
      "",
      "# HELP monorally_client_rtt_ms Network round-trip time of connected clients in milliseconds.",
      "# TYPE monorally_client_rtt_ms summary",
      `monorally_client_rtt_ms{quantile="0.5"} ${rtt.p50}`,
      `monorally_client_rtt_ms{quantile="0.9"} ${rtt.p90}`,
      `monorally_client_rtt_ms{quantile="0.95"} ${rtt.p95}`,
      `monorally_client_rtt_ms{quantile="0.99"} ${rtt.p99}`,
      `monorally_client_rtt_ms_count ${rtt.count}`,
      "",
      "# HELP monorally_matchmaker_wait_duration_ms Time in queue before match allocation in milliseconds.",
      "# TYPE monorally_matchmaker_wait_duration_ms summary",
      `monorally_matchmaker_wait_duration_ms{quantile="0.5"} ${wait.p50}`,
      `monorally_matchmaker_wait_duration_ms{quantile="0.95"} ${wait.p95}`,
      `monorally_matchmaker_wait_duration_ms{quantile="0.99"} ${wait.p99}`,
      `monorally_matchmaker_wait_duration_ms_count ${wait.count}`,
      "",
      "# HELP monorally_process_resident_memory_bytes Resident memory size in bytes.",
      "# TYPE monorally_process_resident_memory_bytes gauge",
      `monorally_process_resident_memory_bytes ${mem.rssBytes}`,
      "",
      "# HELP monorally_process_heap_used_bytes V8 heap memory used in bytes.",
      "# TYPE monorally_process_heap_used_bytes gauge",
      `monorally_process_heap_used_bytes ${mem.heapUsedBytes}`,
      "",
      "# HELP monorally_estimated_bytes_per_room Estimated heap memory bytes per active room.",
      "# TYPE monorally_estimated_bytes_per_room gauge",
      `monorally_estimated_bytes_per_room ${mem.estimatedBytesPerRoom}`,
      "",
      "# HELP monorally_process_cpu_user_seconds_total Total user CPU time spent in seconds.",
      "# TYPE monorally_process_cpu_user_seconds_total counter",
      `monorally_process_cpu_user_seconds_total ${cpu.userSeconds}`,
      "",
      "# HELP monorally_process_cpu_system_seconds_total Total system CPU time spent in seconds.",
      "# TYPE monorally_process_cpu_system_seconds_total counter",
      `monorally_process_cpu_system_seconds_total ${cpu.systemSeconds}`,
      "",
      "# HELP monorally_event_loop_lag_ms Event loop delay in milliseconds.",
      "# TYPE monorally_event_loop_lag_ms summary",
      `monorally_event_loop_lag_ms{quantile="0.5"} ${this.getEventLoopLagStats().p50}`,
      `monorally_event_loop_lag_ms{quantile="0.9"} ${this.getEventLoopLagStats().p90}`,
      `monorally_event_loop_lag_ms{quantile="0.99"} ${this.getEventLoopLagStats().p99}`,
      `monorally_event_loop_lag_ms{quantile="1.0"} ${this.getEventLoopLagStats().max}`,
      `monorally_event_loop_lag_ms_mean ${this.getEventLoopLagStats().mean}`,
      "",
      "# HELP monorally_outbound_bytes_total Total outbound payload bytes sent.",
      "# TYPE monorally_outbound_bytes_total counter",
      `monorally_outbound_bytes_total ${this.outboundBytesTotal}`,
      "",
      "# HELP monorally_send_buffer_pressure_bytes Total buffered outbound bytes across active connections.",
      "# TYPE monorally_send_buffer_pressure_bytes gauge",
      `monorally_send_buffer_pressure_bytes ${this.sendBufferPressureBytes}`,
      ""
    ];

    return lines.join("\n");
  }
}

export const metrics = new MetricsRegistry();
