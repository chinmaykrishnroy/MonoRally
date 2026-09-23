import { QUICK_MATCH_FALLBACK_MS } from "../config.js";
import { metrics } from "../metrics.js";

/**
 * MatchmakerService
 * Coordinates matchmaking queues across all gateways and dispatches matches to least-loaded workers.
 */
export class MatchmakerService {
  constructor({ bus, workerRegistry, fallbackMs = QUICK_MATCH_FALLBACK_MS }) {
    this.bus = bus;
    this.workerRegistry = workerRegistry;
    this.fallbackMs = fallbackMs;
    this.queues = {
      "1v1": [],
      "2v2": []
    };
    this.timers = new Map(); // clientId -> timeoutId
    this.subscriptions = [];
  }

  async start() {
    this.subscriptions.push(
      await this.bus.subscribe("matchmaker.queue.join", (data) => {
        this.enqueue(data);
      })
    );

    this.subscriptions.push(
      await this.bus.subscribe("matchmaker.queue.leave", (data) => {
        this.dequeue(data.clientId);
      })
    );

    this.subscriptions.push(
      await this.bus.subscribe("matchmaker.allocate_room", async (data, replyTo) => {
        if (!replyTo) return;
        const res = await this.allocateOnBestWorker(data);
        await this.bus.publish(replyTo, res);
      })
    );
  }

  async stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
  }

  enqueue(player) {
    const mode = player.mode === "2v2" ? "2v2" : "1v1";
    this.dequeue(player.clientId);

    const queue = this.queues[mode];
    const entry = {
      ...player,
      enqueuedAt: Date.now()
    };
    queue.push(entry);

    const needed = mode === "2v2" ? 4 : 2;
    if (queue.length >= needed) {
      const matched = queue.splice(0, needed);
      const now = Date.now();
      for (const p of matched) {
        this.clearPlayerTimer(p.clientId);
        if (p.enqueuedAt) metrics.recordMatchmakerWait(now - p.enqueuedAt);
      }
      metrics.setMatchmakerQueue(this.queues["1v1"].length + this.queues["2v2"].length);
      this.dispatchMatch(mode, matched, false);
      return;
    }

    metrics.setMatchmakerQueue(this.queues["1v1"].length + this.queues["2v2"].length);

    const timer = setTimeout(() => {
      this.clearPlayerTimer(player.clientId);
      const idx = queue.findIndex((p) => p.clientId === player.clientId);
      if (idx !== -1) {
        const [timedOutPlayer] = queue.splice(idx, 1);
        if (timedOutPlayer.enqueuedAt) metrics.recordMatchmakerWait(Date.now() - timedOutPlayer.enqueuedAt);
        metrics.setMatchmakerQueue(this.queues["1v1"].length + this.queues["2v2"].length);
        this.dispatchMatch(mode, [timedOutPlayer], true);
      }
    }, this.fallbackMs);

    this.timers.set(player.clientId, timer);
  }

  dequeue(clientId) {
    this.clearPlayerTimer(clientId);
    for (const mode of ["1v1", "2v2"]) {
      const q = this.queues[mode];
      const idx = q.findIndex((p) => p.clientId === clientId);
      if (idx !== -1) {
        q.splice(idx, 1);
      }
    }
    metrics.setMatchmakerQueue(this.queues["1v1"].length + this.queues["2v2"].length);
  }

  clearPlayerTimer(clientId) {
    const t = this.timers.get(clientId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(clientId);
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
