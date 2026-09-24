import { QUICK_MATCH_FALLBACK_MS } from "../config.js";
import { metrics } from "../metrics.js";
import { createMatchmakingQueue } from "../redis/matchmaking-queue.js";

/**
 * MatchmakerService
 * Coordinates matchmaking queues across all gateways and dispatches matches to least-loaded workers.
 * Multi-replica safe: uses Redis-backed atomic claims and NATS queue groups.
 */
export class MatchmakerService {
  constructor({ bus, workerRegistry, matchmakingQueue = null, fallbackMs = QUICK_MATCH_FALLBACK_MS }) {
    this.bus = bus;
    this.workerRegistry = workerRegistry;
    this.queue = matchmakingQueue || createMatchmakingQueue();
    this.fallbackMs = fallbackMs;
    this.subscriptions = [];
    this.pollTimer = null;
    this.warmedUpClients = new Set();
  }

  async start() {
    this.subscriptions.push(
      await this.bus.subscribe(
        "matchmaker.queue.join",
        async (data) => {
          await this.enqueue(data);
        },
        { queue: "matchmakers" }
      )
    );

    this.subscriptions.push(
      await this.bus.subscribe(
        "matchmaker.queue.leave",
        async (data) => {
          await this.dequeue(data.clientId);
        },
        { queue: "matchmakers" }
      )
    );

    this.subscriptions.push(
      await this.bus.subscribe(
        "matchmaker.allocate_room",
        async (data, replyTo) => {
          if (!replyTo) return;
          const res = await this.allocateOnBestWorker(data);
          await this.bus.publish(replyTo, res);
        },
        { queue: "matchmakers" }
      )
    );

    // Periodic check for timed-out players to enter warmup while remaining in queue
    this.pollTimer = setInterval(async () => {
      await this.checkFallbackTimeouts();
    }, 1000);
  }

  async stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.warmedUpClients.clear();
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  async enqueue(player) {
    const mode = player.mode === "2v2" ? "2v2" : "1v1";
    await this.queue.enqueue(player);

    const needed = mode === "2v2" ? 4 : 2;
    const matched = await this.queue.claimGroup(mode, needed);

    if (matched && matched.length === needed) {
      const now = Date.now();
      for (const p of matched) {
        if (p.enqueuedAt) metrics.recordMatchmakerWait(now - p.enqueuedAt);
        this.warmedUpClients.delete(p.clientId);
      }
      const totalDepth = await this.queue.getTotalDepth();
      metrics.setMatchmakerQueue(totalDepth);
      await this.dispatchMatch(mode, matched, false);
      return;
    }

    const totalDepth = await this.queue.getTotalDepth();
    metrics.setMatchmakerQueue(totalDepth);
  }

  async dequeue(clientId) {
    this.warmedUpClients.delete(clientId);
    await this.queue.dequeue(clientId);
    const totalDepth = await this.queue.getTotalDepth();
    metrics.setMatchmakerQueue(totalDepth);
  }

  async checkFallbackTimeouts() {
    for (const mode of ["1v1", "2v2"]) {
      const candidates = await this.queue.getTimedOutCandidates(mode, this.fallbackMs);
      for (const candidate of candidates) {
        if (!this.warmedUpClients.has(candidate.clientId)) {
          this.warmedUpClients.add(candidate.clientId);
          // Notify client to start local AI warmup while remaining in human queue
          await this.bus.publish(`gateway.${candidate.gatewayId}.client.${candidate.clientId}.send`, {
            t: "quickWarmup",
            mode
          });
        }
      }
    }
  }

  async allocateOnBestWorker(roomConfig) {
    const worker = await this.workerRegistry.getLeastLoadedWorker();
    if (!worker) {
      return { ok: false, error: "No available workers with capacity" };
    }
    try {
      const res = await this.bus.request(`worker.${worker.workerId}.allocate_room`, roomConfig, 3000);
      return { ok: true, workerId: worker.workerId, ...res };
    } catch (err) {
      return { ok: false, error: `Worker ${worker.workerId} failed to allocate room: ${err.message}` };
    }
  }

  async dispatchMatch(mode, players, isAiFallback) {
    for (const p of players) {
      this.warmedUpClients.delete(p.clientId);
    }
    const worker = await this.workerRegistry.getLeastLoadedWorker();
    const roomConfig = {
      mode,
      visibility: "public",
      isAiFallback,
      initialPlayers: players.map((p) => ({
        clientId: p.clientId,
        gatewayId: p.gatewayId,
        name: p.name,
        teamPreference: p.teamPreference,
        sessionId: p.sessionId,
        playerId: p.playerId,
        protocol: p.protocol
      }))
    };

    let result;
    if (worker) {
      try {
        result = await this.bus.request(`worker.${worker.workerId}.allocate_room`, roomConfig, 3000);
      } catch (err) {
        console.error(`[Matchmaker] Failed to allocate on worker ${worker.workerId}:`, err);
      }
    }

    if (!result || !result.roomCode) {
      // Notify players of matchmaking error
      for (const p of players) {
        await this.bus.publish(`gateway.${p.gatewayId}.client.${p.clientId}.send`, {
          t: "error",
          message: "Unable to allocate match server. Please retry."
        });
      }
      return;
    }

    // Direct each player's gateway to join the room
    for (const p of players) {
      await this.bus.publish(`gateway.${p.gatewayId}.client.${p.clientId}.send`, {
        t: "matchmaker.assigned",
        roomCode: result.roomCode,
        workerId: result.workerId || worker?.workerId
      });
    }
  }
}
