# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.10.0] - 2026-09-23

### Highlights
- High-Resolution Match Result Cards: Off-screen 1200×630 canvas generator creating dark cyberpunk post-match cards with one-click clipboard image copy (`navigator.clipboard.write`), PNG file download, and native device share sheet integration.
- Deterministic Compact Match Replay Engine: In-browser ~15 Hz keyframe recording (~25–35 KB per match), 60+ FPS interpolated playback HUD with interactive timeline scrubber, variable playback speeds (`0.5x`, `1x`, `2x`), local replay history library in `localStorage`, and portable JSON file export/import.
- Rich OpenGraph & SEO Metadata: Complete social preview meta cards (`og:title`, `og:description`, `og:image`, `twitter:card`), dedicated 1200×630 cyberpunk social card (`/og-image.png`), `VideoGame` JSON-LD structured data, enhanced PWA web manifest shortcuts, and offline service worker caching.

### Added
- Result card generator `client/src/sharing/result-card.js` with `renderResultCard`, `formatDuration`, and clipboard/file export utilities.
- Share card modal controller `client/src/sharing/share-modal.js` for previewing and exporting result cards.
- Replay recorder `client/src/replay/replay-recorder.js` for lightweight client-side match keyframe recording (~15 Hz).
- Replay player `client/src/replay/replay-player.js` with smooth Hermite/linear interpolation and timeline scrubbing.
- Replay store `client/src/replay/replay-store.js` for localStorage persistence, eviction, and JSON import/export.
- Share Card modal, Replay HUD, and Recent Replays list in `client/public/index.html` and `client/public/styles.css`.
- Comprehensive unit test suites in `tests/unit/result-card.test.js`, `tests/unit/replay.test.js`, and `tests/unit/replay-store.test.js`.
- Playwright E2E browser tests for OpenGraph head metadata and Recent Replays UI in `tests/e2e/monorally.spec.js`.

### Fixed
- Fixed replay guard ordering in `server/src/index.js` ensuring `room.status !== "ended"` returns `"Replay is available after game over"` before evaluating connected player presence.

## [v1.9.0] - 2026-09-23

### Highlights
- Mutual Rematch Consent Flow: Symmetrical 15-second mutual acceptance countdown for 2-player human matches with instant room reset upon dual consent, leave-to-decline feedback, and instant zero-wait replay in solo AI practice.
- Spectator Cheers & Live Reactions: Real-time floating spectator emojis (`👏`, `🔥`, `⚡`, `🚀`, `🎯`) with server rate-limiting, cross-gateway pub/sub distribution, and animated canvas particle rendering.
- Background AI Warmup Matchmaking: Instant on-court practice while queueing for online opponents, with seamless hot-swap transition into the multiplayer room when a match is found.
- Direct Link Room Sharing: Web Share API integration with automatic fallback to clipboard copy, deep-link URL parameter joining (`?join=CODE&role=player`), and frictionless cross-platform game invites.

### Added
- Rematch consent evaluation engine in `server/src/rematch.js` (`evaluateRematchRequest`, `handlePlayerLeaveRematch`).
- Spectator cheer system and rate limiting in `server/src/cheer.js`.
- Spectator cheers UI toolbar in `client/public/index.html` and sleek CSS pill styling in `client/public/styles.css`.
- Upward floating emoji particle rendering in `client/src/rendering/renderer.js`.
- "Warmup while searching" instant court entry button in `client/public/index.html` and background queue coordinator in `client/src/main.js` and `client/src/ui/play-flow.js`.
- Deep-link URL parameter parsing (`?join=CODE&role=player`) and room auto-joining in `client/src/main.js`.
- Unit test suites in `tests/unit/rematch-consent.test.js` and `tests/unit/cheer.test.js`.
- Playwright E2E browser tests in `tests/e2e/monorally.spec.js` validating rematch consent banner and spectator cheer toolbar rendering.

### Changed
- Unified server (`server/src/index.js`), distributed worker (`server/src/services/worker-service.js`), and room lifecycle (`server/src/room-lifecycle.js`) upgraded to support mutual rematch consent states (`rematch_requested`, `rematch_declined`).
- Distributed gateway (`server/src/services/gateway-service.js`) and unified server updated to dispatch spectator cheer events over the message bus.
- Room sharing updated to use Web Share API (`navigator.share`) with automatic clipboard copy fallback.

## [v1.8.0] - 2026-09-23

### Highlights
- Anonymous-First Player Profiles: Frictionless persistent identity stored locally and synced with backend repositories without requiring mandatory registration, email, or passwords.
- Symmetrical Ranked Elo Rating Engine: Server-authoritative Elo system ($K=32$) computing expected matchup scores and rating exchanges strictly for competitive human encounters.
- Six-Tier Rank Progression: Bronze (<1200), Silver (1200–1399), Gold (1400–1599), Platinum (1600–1799), Diamond (1800–1999), and Master (2000+) tiers with dynamic badge styling and progression progress bars.
- Profile Modal & Combat Statistics: Full dashboard showing Elo rating, peak rating, win rate %, win streaks, peak return speed, skill shot breakdown (Smash, Curve, Counter, Drive), and recent match history.
- Milestone Achievements: Unlocked tokens celebrating competitive progression (Rookie Pilot, Rally Centurion, Gold Standard, Unstoppable Streak, Sonic Boomer, Smash Specialist).
- Dual Backend Parity: Full schema migration and ranked leaderboard querying supported seamlessly across PostgreSQL (`002_player_profiles_and_ratings.sql`) and in-memory repository fallbacks.

### Added
- Symmetrical Elo rating engine in `server/src/elo.js` with pure mathematical calculation and tier assignment.
- Database migration `server/src/db/migrations/002_player_profiles_and_ratings.sql` adding ratings, streaks, and skill shot counters.
- Profile stats updates, match history persistence, and ranked leaderboard queries in `server/src/repositories/player-repository.js` and `server/src/repositories/match-repository.js`.
- Unified match finalizer in `server/src/match-finalizer.js` linking match completion, human Elo delta calculation, and leaderboard updates.
- REST endpoints `POST /api/profile`, `GET /api/profile`, and `GET /api/ranked/leaderboard` in `server/src/http.js`.
- Player profile client modules `client/src/core/profile.js` and `client/src/ui/profile-ui.js`.
- Profile UI markup in `client/public/index.html` and sleek cyberpunk dashboard styles in `client/public/styles.css`.
- Comprehensive unit tests in `tests/unit/elo.test.js`, `tests/unit/player-repository.test.js`, and `tests/unit/profile-ui.test.js`.
- End-to-end Playwright browser test verifying profile modal opening and display.

### Changed
- `hello` messages and room join/creation messages now forward client `playerId` for persistent stats attribution.
- In-memory repository stores match records and computes ranked leaderboards with exact parity to PostgreSQL.

## [v1.7.0] - 2026-09-23

### Highlights
- Server-Authoritative Skill Shot System: Physical paddle contact classification identifying **Smash** ($1.35\times$ acceleration boost), **Curve** (wicked $\pm 1400\text{ px/s}^2$ Magnus spin), **Counter / Parry** (redirected momentum off fast incoming balls), and **Drive** (laser-flat trajectory on centered contact).
- Overdrive Powerup: Rare collectible powerup orb that charges paddles with cyber emerald energy, instantly supercharging every return into an amplified Smash for 5 seconds.
- Floating Skill Badges: Real-time on-court dynamic floating typography badges (`SMASH!`, `CURVE!`, `COUNTER!`, `DRIVE!`) matching theme accents with kinetic scale and fade animations.
- Procedural Synthesizer Audio: Zero-asset, zero-latency Web Audio oscillator synthesis with custom frequency sweeps, harmonics, and resonant filter envelopes tailored to each skill shot and powerup.
- Backward-Compatible Binary Protocol: High-nibble bit-packing in `lastHit` binary byte and player flag bit-masking maintaining 100% two-way protocol compatibility.

### Added
- `classifyShot` and `overdriveStrength` physics engine modules in `server/src/physics.js`.
- `overdrive` powerup rotation in `server/src/index.js` and `server/src/services/worker-service.js`.
- Bit-packed `shotType` and `overdrive` player flag encoding/decoding in `server/src/serialization.js` and `client/src/network/protocol.js`.
- Procedural sound synthesis methods (`playSmash`, `playCurve`, `playCounter`, `playDrive`, overdrive chord) in `client/src/ui/audio.js`.
- Skill shot typography badges and overdrive glowing paddle aura in `client/src/rendering/renderer.js`.
- Skill shot and overdrive unit tests in `tests/unit/physics.test.js` and `tests/unit/protocol.test.js`.

### Changed
- `applyPaddleBounce` dynamically adjusts return speed, trajectory angle, and curve spin based on skill shot classification.
- `lastHit` events dispatched to clients carry the validated server-authoritative `shotType`.

## [v1.6.0] - 2026-09-23

### Highlights
- Customizable Accent Color Themes: Instant in-game theme switching between Neon Cyan, Solar Amber, Cyber Emerald, Plasma Violet, and Classic Monochrome.
- High-Contrast Accessibility Mode: Full WCAG-conscious high-contrast mode with prominent 2px-3px dynamic boundary strokes on paddles, balls, and court boundaries.
- Dynamic Velocity Trails & Supersonic Bloom: Ball trails dynamically scale their length and taper with ball velocity; balls traveling over 480 px/s render a supersonic glowing accent bloom.
- Squash, Stretch & Impact Shockwaves: Velocity-directed elliptical ball stretching and physical paddle impact deformation, accompanied by multi-tier expanding shockwave rings on smashes.
- Interactive Live Preview & Client Persistence: Selected theme and accessibility preferences immediately apply to DOM datasets and persist across page refreshes.

### Added
- `theme` and `highContrast` properties in client settings state (`client/src/core/shared.js`).
- Accent theme and high-contrast accessibility controls in the settings modal (`client/public/index.html`).
- Theme custom properties and high-contrast styles in `client/public/styles.css`.
- Dynamic ball trail rendering with velocity blooms and theme integration in `client/src/rendering/renderer.js`.
- Ball squash & stretch physics deformation along velocity angle in `client/src/rendering/renderer.js`.
- Multi-tier expanding shockwave rings on high-velocity impacts in `client/src/rendering/renderer.js`.
- Unit test suite for settings UI, theme, and contrast persistence in `tests/unit/settings-ui.test.js`.
- End-to-end Playwright tests verifying settings modal theme selection, contrast mode, and refresh persistence across multiple browser viewports.

### Changed
- `drawBallTrails` is now actively integrated into the main canvas rendering pipeline prior to ball rendering.
- Court boundaries render enhanced high-visibility borders when accessibility contrast mode is active.

## [v1.5.0] - 2026-09-23

### Highlights
- Worker Draining & Zero-Match-Drop Upgrades: Simulation workers entering shutdown flag themselves as `draining` in Redis, reject new match allocations, allow ongoing matches to finish cleanly, and terminate gracefully via `terminationGracePeriodSeconds: 120`.
- Automated Traffic Redirection: Matchmaker automatically diverts new incoming matchmaking traffic to healthy, ready workers while draining workers complete existing matches.
- Kubernetes Dynamic Autoscaling (HPA): Created Horizontal Pod Autoscaler configurations for stateless Gateway pods (3 to 50 replicas) and simulation Worker pods (4 to 100 replicas) based on CPU and memory utilization.
- High Availability & Disruption Budgets (PDB): Configured PodDisruptionBudgets enforcing minimum replica availability during voluntary Kubernetes node maintenance and rolling upgrades.
- Crash Recovery & Stale Lease Pruning: Ephemeral Redis room leases automatically expire and are purged if a worker encounters an abrupt fault, preventing orphaned room locks.
- Added `POST /drain` endpoint to the HTTP server for triggering graceful draining via Kubernetes container `preStop` hooks.

### Added
- `WorkerService.prototype.drain()` method with graceful match completion monitoring and configurable timeout safety.
- `markWorkerDraining()` and `cleanStaleLeases()` in `WorkerRegistry` (`server/src/redis/worker-registry.js`).
- `POST /drain` HTTP route in `server/src/http.js` and drain handling in `server/src/index.js`.
- Kubernetes autoscaling and disruption manifests in `deploy/k3s/autoscaling.yaml` (HPA & PDB).
- `terminationGracePeriodSeconds: 120` and `preStop` lifecycle hook in `deploy/k3s/distributed.yaml`.
- Worker draining unit test suite (`tests/unit/worker-draining.test.js`).
- Resilience, rolling update, and crash recovery chaos integration test suite (`tests/integration/resilience-chaos.test.js`).

### Changed
- `WorkerRegistry.getLeastLoadedWorker()` now strictly filters out workers in `draining` status.
- `WorkerService.tickRoom()` prunes finished rooms when draining or after post-game countdowns.

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
