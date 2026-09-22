# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.4.0] - 2026-09-23

### Highlights
- Decoupled connection termination from physics simulation: introduced dedicated, horizontally scalable service roles (`Gateway`, `Worker`, and `Matchmaker`) capable of scaling to 200+ replicas.
- Added low-latency messaging via NATS Core (`NatsBus`) for wire-speed pub/sub and RPC routing of client inputs, room commands, and 30 Hz compressed snapshot broadcasts.
- Built a high-performance in-memory event bus (`MemoryBus`) with full NATS wildcard semantics (`*`, `>`) and request-reply inboxes, ensuring unified deployments and CI test suites run with zero external broker dependencies.
- Implemented Redis-backed worker capacity discovery and distributed room ownership leases (`room:lease:<roomCode>`) using atomic Lua scripts for renewals and releases to guarantee single-worker simulation ownership.
- Added multi-pod distributed Kubernetes deployment manifests (`deploy/k3s/distributed.yaml`) separating stateless Gateways, simulation Workers, Matchmaker, and NATS cluster.

### Added
- Abstract `EventBus` interface and factory (`server/src/bus/index.js`), in-memory bus (`server/src/bus/memory-bus.js`), and NATS client bus (`server/src/bus/nats-bus.js`).
- Distributed worker registry and room lease manager (`server/src/redis/worker-registry.js`).
- `GatewayService` (`server/src/services/gateway-service.js`) for WebSocket termination, session validation, and bus multiplexing.
- `WorkerService` (`server/src/services/worker-service.js`) for RAM-isolated 60 Hz physics simulation and continuous collision detection.
- `MatchmakerService` (`server/src/services/matchmaker-service.js`) for 1v1 and 2v2 queuing and capacity-aware worker dispatch.
- Event bus unit test suite (`tests/unit/event-bus.test.js`) and worker registry unit test suite (`tests/unit/worker-registry.test.js`).
- Multi-replica distributed multiplayer integration test (`tests/integration/distributed-multiplayer.test.js`) verifying cross-gateway client pairing, input routing, and snapshot delivery.
- Docker Compose configuration updated with NATS 2.10 service.
- Kubernetes multi-replica deployment manifests in `deploy/k3s/distributed.yaml`.

### Changed
- Server bootstrap in `server/src/index.js` now initializes event bus and worker registry and supports `SERVICE_ROLE` (`unified`, `gateway`, `worker`, `matchmaker`).
- Readiness probe now reports active service role and message bus backend.
- Updated `.env.example` with `SERVICE_ROLE`, `BUS_TYPE`, `NATS_URL`, and `NATS_PORT`.

## [v1.3.0] - 2026-09-23

### Highlights
- Built the distributed data foundation: durable data (players, match histories, leaderboards) is backed by PostgreSQL, while ephemeral state (sessions, presence, rate limits, leaderboard caching) is backed by Redis.
- Enabled multi-replica safe migrations using PostgreSQL session advisory locks (`pg_advisory_lock(7148492)`), allowing concurrent pod startups without race conditions or migration conflicts.
- Completely decoupled application pods from local disk state: removed the `/data/leaderboard.json` production requirement so pods are completely stateless and support Kubernetes zero-downtime `RollingUpdate` deployments.
- Added Kubernetes and container health checks with `/health/live` (process liveness) and `/health/ready` (readiness probing PostgreSQL and Redis connectivity).
- Preserved graceful in-memory fallbacks across all repositories and stores, allowing standalone local development and automated CI tests to run with zero external dependencies.
- Added legacy migration CLI utility (`scripts/migrate-leaderboard-json.js`) to migrate historical JSON leaderboards into PostgreSQL.

### Added
- PostgreSQL connection pool manager (`server/src/db/pool.js`) with health validation and connection recycling.
- Distributed migration framework (`server/src/db/migrator.js`) with advisory locking and migration tracking table.
- Initial PostgreSQL schema (`001_initial_schema.sql`) for players, match records, player match statistics, and leaderboard snapshots.
- Redis client factory (`server/src/redis/client.js`), distributed session store (`server/src/redis/session-store.js`), presence store (`server/src/redis/presence-store.js`), and rate limiter (`server/src/redis/rate-limiter.js`).
- Repositories: `PostgresLeaderboardRepository` (with Redis read cache and TTL invalidation), `PostgresPlayerRepository`, `PostgresMatchRepository`, alongside in-memory equivalents.
- Health endpoints `/health/live` and `/health/ready` in `server/src/http.js`.
- Docker Compose configuration updated with PostgreSQL 16 and Redis 7 containers.
- Kubernetes deployment (`deploy/k3s/monorally.yaml`) converted to stateless `RollingUpdate` with readiness and liveness probes.
- Repository unit tests (`tests/unit/repositories.test.js`) and multi-replica distributed data integration tests (`tests/integration/distributed-data.test.js`).

### Changed
- MonoRally HTTP server now initializes data backend asynchronously and responds to liveness and readiness probes.
- Updated `.env.example` with `DATA_BACKEND`, `DATABASE_URL`, and `REDIS_URL`.

## [v1.2.7] - 2026-09-23

### Highlights
- Solved false misses during high-speed ball crossings and jittery network conditions using swept analytic continuous collision detection (CCD) and an adaptive late-input timeline reconciliation window.
- Out-of-order and wrapped input packets are classified cleanly and retained in player history for retrospective collision adjudication.
- Safeguarded WebSocket binary protocol dispatch against uncaught packet-handling exceptions.
- Added structured opt-in network and collision telemetry (`DEBUG_NETWORK_TELEMETRY`).
- Fixed room status transitions, quick-match fallback timers, and rematch race conditions.
- Upgraded the leaderboard client UI to explicitly distinguish loading, empty, and failure states.

### Added
- Analytic swept continuous collision detection for paddle contacts (`segmentCapsuleHitT`, `segmentAabbHitT`, `segmentCircleHitT`).
- 16-bit sequence classification (`classifyInputSequence`) supporting modulo 65536 wrapping, duplicate rejection, and historical out-of-order retention.
- Opt-in structured network telemetry (`server/src/network-telemetry.js`) covering `collision.pending`, `collision.adjudicated`, and `input.reordered`.
- Comprehensive network simulation test suite (`tests/unit/network-simulation.test.js`) validating 20ms–250ms RTT, 10ms–80ms jitter, 1–3% packet loss, bursty delay, reordering, corner collisions, maximum ball speed, and anti-cheat bounding.
- Playwright E2E verification for explicit leaderboard error state rendering.

### Improved
- Client WebSocket reconnect management now uses generation counters to prevent leaked timers from spawning spurious connections.
- Public room directory queries now strictly filter out ended rooms, ensuring only `waiting` and `running` rooms are presented.
- Leaderboard client UI now displays an explicit error message (`Leaderboard unavailable`) with `role="alert"` instead of misleadingly displaying zero records on network or backend failure.

### Fixed
- Fixed high-speed ball tunneling and jitter-induced false misses via analytic capsule sweep and historical input interpolation.
- Fixed unhandled exception vulnerability when processing malformed binary frames.
- Fixed memory and state leaks where quick-match fallback timers persisted beyond room termination.
- Fixed rematch/replay race conditions by adding a transition guard (`replayStarting`).

### Networking
- Preserved historical out-of-order input samples in `player.inputHistory` so legitimate late inputs arriving during the `pendingMiss` grace window are accurately adjudicated at the crossing timestamp.
- Maintained strict anti-cheat boundaries by enforcing physical maximum speed (`PADDLE_MAX_SPEED = 4200`) and acceleration (`PADDLE_ACCELERATION = 30000`).

### Tests
- Added 11 deterministic network impairment and collision fairness unit tests.
- Added 16-bit sequence wrapping and out-of-order classification unit tests.
- Added WebSocket binary frame exception safety test.
- Added Playwright end-to-end test for leaderboard failure handling.

### Upgrade Notes
- Backward compatible with v1.2.x clients and protocols (v1–v4).
- Safe in-place rolling update for v1.2.6 single-instance deployments.
