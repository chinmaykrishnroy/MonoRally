import {
  ALLOWED_ORIGINS,
  CLIENT_TIMEOUT_MS,
  DATABASE_URL,
  DATA_BACKEND,
  GATEWAY_ID,
  HEARTBEAT_MS,
  H,
  INPUT_HISTORY_MS,
  INPUT_FUTURE_TOLERANCE_MS,
  INPUT_RATE_LIMIT_PER_SECOND,
  INPUT_PACKET,
  LEADERBOARD_FILE,
  MAX_SPECTATORS,
  PORT,
  PADDLE_ACCELERATION,
  PADDLE_MAX_SPEED,
  QUICK_AI_DIFFICULTY,
  QUICK_MATCH_FALLBACK_MS,
  REDIS_URL,
  TICK,
  W,
  BUS_TYPE,
  NATS_URL,
  SERVICE_ROLE,
  WORKER_ID,
  WORKER_CAPACITY_MAX_ROOMS
} from "./config.js";
import { checkDatabaseHealth, closeDatabasePool, createDatabasePool } from "./db/pool.js";
import { runMigrations } from "./db/migrator.js";
import { checkRedisHealth, closeRedisClient, createRedisClient } from "./redis/client.js";
import { createSessionStore } from "./redis/session-store.js";
import { createPresenceStore } from "./redis/presence-store.js";
import { createDistributedRateLimiter } from "./redis/rate-limiter.js";
import { createLeaderboardRepository } from "./repositories/leaderboard-repository.js";
import { createPlayerRepository } from "./repositories/player-repository.js";
import { createMatchRepository } from "./repositories/match-repository.js";
import { attachWebSocketServer } from "./connection.js";
import { createHttpServer } from "./http.js";
import { createLeaderboard } from "./leaderboard.js";
import { metrics } from "./metrics.js";
import { startUnifiedNode } from "./unified.js";
import { createEventBus } from "./bus/index.js";
import { MemoryBus } from "./bus/memory-bus.js";
import { createWorkerRegistry } from "./redis/worker-registry.js";
import { createRoomDirectory } from "./redis/room-directory.js";
import { createMatchmakingQueue } from "./redis/matchmaking-queue.js";
import { GatewayService } from "./services/gateway-service.js";
import { WorkerService } from "./services/worker-service.js";
import { MatchmakerService } from "./services/matchmaker-service.js";

export async function createInfra(options = {}) {
  const role = options.role || SERVICE_ROLE;
  const isDistributed = role !== "unified" && (options.isDistributed !== undefined ? options.isDistributed : process.env.NODE_ENV !== "test");

  // Enforce Fail-Closed behavior for distributed production roles
  if (isDistributed) {
    if (DATA_BACKEND === "postgres" && !DATABASE_URL && options.pool === undefined) {
      throw new Error(`[bootstrap] Fatal: DATABASE_URL is required for distributed SERVICE_ROLE="${role}"`);
    }
    if (!REDIS_URL && !options.redis) {
      throw new Error(`[bootstrap] Fatal: REDIS_URL is required for distributed SERVICE_ROLE="${role}"`);
    }
    const busType = options.busType || BUS_TYPE;
    if (busType === "memory" && !options.bus) {
      throw new Error(`[bootstrap] Fatal: BUS_TYPE="memory" is rejected for distributed SERVICE_ROLE="${role}". Distributed production roles require a real external message bus.`);
    }
    if (busType === "nats" && !NATS_URL && !options.bus) {
      throw new Error(`[bootstrap] Fatal: NATS_URL is required for distributed SERVICE_ROLE="${role}" with BUS_TYPE=nats`);
    }
  }

  const pool = options.pool !== undefined ? options.pool : (DATABASE_URL ? createDatabasePool(DATABASE_URL) : null);
  const redis = options.redis !== undefined ? options.redis : (REDIS_URL ? createRedisClient(REDIS_URL) : null);
  const bus = options.bus || (await createEventBus({
    type: options.busType || BUS_TYPE,
    url: NATS_URL,
    allowFallback: !isDistributed
  }));

  if (isDistributed && !options.bus && bus instanceof MemoryBus) {
    throw new Error(`[bootstrap] Fatal: BUS_TYPE="memory" is rejected for distributed SERVICE_ROLE="${role}". Distributed production roles require a real external message bus.`);
  }

  // Verify Redis connectivity in distributed roles
  if (isDistributed && redis) {
    const redisHealth = await checkRedisHealth(redis);
    if (!redisHealth.healthy) {
      throw new Error(`[bootstrap] Fatal: Redis health check failed for role "${role}": ${redisHealth.reason}`);
    }
  }

  let migrationHealthy = true;
  let migrationError = null;
  if (pool) {
    try {
      const { applied } = await runMigrations(pool);
      if (applied?.length) console.log(`[db] Applied ${applied.length} migrations: ${applied.join(", ")}`);
    } catch (err) {
      migrationHealthy = false;
      migrationError = err.message;
      console.error("[db] Migration error:", err.message);
      if (isDistributed) {
        throw new Error(`[bootstrap] Fatal: Database migration failed for distributed role "${role}": ${err.message}`);
      }
    }
  }

  const workerRegistry = options.workerRegistry || createWorkerRegistry(redis);
  const roomDirectory = options.roomDirectory || createRoomDirectory(redis);
  const matchmakingQueue = options.matchmakingQueue || createMatchmakingQueue(redis);

  const leaderboard = options.leaderboard || (pool || redis ? createLeaderboardRepository({ pool, redis }) : createLeaderboard(LEADERBOARD_FILE));
  const playerRepository = options.playerRepository || createPlayerRepository({ pool });
  const matchRepository = options.matchRepository || createMatchRepository({ pool });
  const sessionStore = options.sessionStore || createSessionStore(redis);
  const presenceStore = options.presenceStore || createPresenceStore(redis);
  const rateLimiter = options.rateLimiter || createDistributedRateLimiter(redis);

  const checkHealth = async () => {
    const dbHealth = pool ? await checkDatabaseHealth(pool) : { healthy: true, type: "memory" };
    const redisHealth = redis ? await checkRedisHealth(redis) : { healthy: true, type: "memory" };
    const ready = dbHealth.healthy && redisHealth.healthy && migrationHealthy;
    return {
      ready,
      database: dbHealth,
      redis: redisHealth,
      migration: { healthy: migrationHealthy, error: migrationError },
      role,
      bus: bus?.constructor?.name || BUS_TYPE
    };
  };

  return {
    role,
    pool,
    redis,
    bus,
    workerRegistry,
    roomDirectory,
    matchmakingQueue,
    leaderboard,
    playerRepository,
    matchRepository,
    sessionStore,
    presenceStore,
    rateLimiter,
    checkHealth
  };
}

export async function startGatewayNode(infra, { port = PORT, gatewayId = GATEWAY_ID, maxClients } = {}) {
  const gateway = new GatewayService({
    bus: infra.bus,
    sessionStore: infra.sessionStore,
    presenceStore: infra.presenceStore,
    rateLimiter: infra.rateLimiter,
    workerRegistry: infra.workerRegistry,
    roomDirectory: infra.roomDirectory,
    gatewayId,
    port,
    maxClients
  });

  const server = createHttpServer({
    checkHealth: infra.checkHealth,
    leaderboard: infra.leaderboard,
    playerRepository: infra.playerRepository,
    matchRepository: infra.matchRepository,
    roomDirectory: infra.roomDirectory
  });

  attachWebSocketServer(server, {
    clients: gateway.clients,
    onBinary: (client, data) => gateway.handleBinaryMessage(client, data),
    onDisconnect: (client) => gateway.handleClientDisconnected(client),
    onMessage: (client, msg) => gateway.handleMessage(client, msg)
  });

  await gateway.start();

  await new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[gateway] Gateway ${gatewayId} running at http://localhost:${port}`);
      resolve();
    });
  });

  return {
    role: "gateway",
    gateway,
    server,
    stop: async () => {
      await gateway.stop();
      await new Promise((r) => server.close(r));
      if (infra.redis) await closeRedisClient(infra.redis);
      if (infra.pool) await closeDatabasePool(infra.pool);
      if (infra.bus) await infra.bus.close();
    }
  };
}

export async function startWorkerNode(infra, { port = PORT, workerId = WORKER_ID, maxRooms = WORKER_CAPACITY_MAX_ROOMS } = {}) {
  const worker = new WorkerService({
    bus: infra.bus,
    workerRegistry: infra.workerRegistry,
    roomDirectory: infra.roomDirectory,
    leaderboardRepository: infra.leaderboard,
    playerRepository: infra.playerRepository,
    matchRepository: infra.matchRepository,
    workerId,
    maxRooms
  });

  const server = createHttpServer({
    checkHealth: infra.checkHealth,
    onDrain: async () => {
      worker.draining = true;
      if (infra.workerRegistry) await infra.workerRegistry.markWorkerDraining(workerId);
    }
  });

  await worker.start();

  await new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[worker] Authoritative simulation worker ${workerId} running at http://localhost:${port}`);
      resolve();
    });
  });

  return {
    role: "worker",
    worker,
    server,
    stop: async () => {
      await worker.stop();
      await new Promise((r) => server.close(r));
      if (infra.redis) await closeRedisClient(infra.redis);
      if (infra.pool) await closeDatabasePool(infra.pool);
      if (infra.bus) await infra.bus.close();
    }
  };
}

export async function startMatchmakerNode(infra, { port = PORT, fallbackMs = QUICK_MATCH_FALLBACK_MS } = {}) {
  const matchmaker = new MatchmakerService({
    bus: infra.bus,
    workerRegistry: infra.workerRegistry,
    matchmakingQueue: infra.matchmakingQueue,
    fallbackMs
  });

  const server = createHttpServer({
    checkHealth: infra.checkHealth
  });

  await matchmaker.start();

  await new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`[matchmaker] Matchmaker service running at http://localhost:${port}`);
      resolve();
    });
  });

  return {
    role: "matchmaker",
    matchmaker,
    server,
    stop: async () => {
      await matchmaker.stop();
      await new Promise((r) => server.close(r));
      if (infra.redis) await closeRedisClient(infra.redis);
      if (infra.pool) await closeDatabasePool(infra.pool);
      if (infra.bus) await infra.bus.close();
    }
  };
}

export { startUnifiedNode };

export async function bootstrapNode(options = {}) {
  const infra = await createInfra(options);
  const role = options.role || infra.role;

  switch (role) {
    case "gateway":
      return await startGatewayNode(infra, options);
    case "worker":
      return await startWorkerNode(infra, options);
    case "matchmaker":
      return await startMatchmakerNode(infra, options);
    case "unified":
    default:
      return await startUnifiedNode(infra, options);
  }
}
