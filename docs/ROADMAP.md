# MonoRally Master Mission Roadmap

This document outlines the architectural and product milestones transitioning MonoRally from a single-replica prototype to a horizontally scalable distributed realtime multiplayer platform (supporting 200+ worker/gateway replicas).

---

## Milestone Matrix

| Version | Status | Milestone | Core Focus |
|---|---|---|---|
| **v1.2.6** | Complete | Baseline | Single-instance in-memory physics + JSON persistence baseline |
| **v1.2.7** | Complete | Fairness & Critical Stability Patch | Swept continuous collision detection, jitter-proof input sequencing, error UI |
| **v1.3.0** | Complete | Distributed Data Foundation | PostgreSQL, Redis, database migrations, repository layer, zero local file persistence |
| **v1.4.0** | Complete | Distributed Realtime Multiplayer | Gateway, Match Worker, Matchmaker, NATS Core bus, distributed room ownership |
| **v1.5.0** | Complete | Resilience & Autoscaling | Worker draining, zero-downtime rolling updates, K8s HPA/PDB, failure injection |
| **v1.6.0** | Complete | Premium UX/UI & Visual Identity | Accent color system, velocity trails, squash/stretch, hit-stop, accessibility |
| **v1.7.0** | Complete | Distinctive Gameplay Identity | Signature skill shots (smash, curve, counter, drive), overdrive powerup, procedural audio |
| **v1.8.0** | Complete | Player Profiles, Ranked & Retention | Persistent anonymous identity, Elo matchmaking, match history, personal bests, achievements |
| **v1.10.0** | Complete | Sharing, Replays & Discoverability | Compact deterministic replays, shareable result cards, OpenGraph / SEO |
| **v1.11.0** | Current Release | Large-Scale Validation & Hardening | Synthetic load tests (up to 200 replicas), Prometheus metrics, capacity runbook |

---

## Detailed Milestone Descriptions

### v1.2.7 — Fairness & Critical Stability Patch (PATCH)
- **Objective**: Establish rock-solid collision detection, reliable input timeline sequencing, and safe protocol exception guards.
- **Key Deliverables**: Continuous capsule collision (`segmentCapsuleHitT`), 16-bit sequence wrapping, late-input timeline rescue, opt-in network telemetry, room lifecycle timer cleanup, explicit leaderboard failure reporting.

### v1.3.0 — Distributed Data Foundation (MINOR)
- **Objective**: Eliminate all durable process-local filesystem state.
- **Key Deliverables**:
  - PostgreSQL for durable data: players, matches, match_players, ratings, leaderboard.
  - Redis for ephemeral state: sessions, presence, worker registry, rate limits.
  - Safe database migrations executed with deterministic lock.
  - Docker Compose supporting PostgreSQL + Redis + MonoRally.
  - Integration tests proving multi-replica database consistency.

### v1.4.0 — Distributed Realtime Multiplayer (MINOR)
- **Objective**: Decouple connection management, matchmaking, and physics simulation.
- **Key Deliverables**:
  - Separate service roles: `monorally-gateway`, `monorally-worker`, `monorally-matchmaker`, `monorally-api`.
  - NATS Core bus for low-latency gateway-to-worker communication.
  - Redis-backed room ownership leases and worker heartbeat registrations.
  - Cross-gateway multiplayer: Player A on Gateway 1 and Player B on Gateway 2 play in the same Worker match.

### v1.5.0 — Resilience, Autoscaling & Zero-Downtime Deployment (MINOR)
- **Objective**: Production resilience and graceful lifecycle management under rolling releases.
- **Key Deliverables**:
  - Worker draining protocol: graceful termination without interrupting active matches.
  - Kubernetes manifests: independent Deployments, HPAs, PodDisruptionBudgets, `/health/live` & `/health/ready`.
  - Automated failure-injection test suite (gateway crash, worker drain, Redis reconnect, NATS disconnect).

### v1.6.0 — Premium UX/UI & Visual Identity (MINOR)
- **Objective**: Elevate MonoRally into a polished, minimalist competitive arcade experience.
- **Key Deliverables**:
  - Restrained semantic accent color palette (self, opponent, team, powerup, danger).
  - High-impact visual effects: ball trails, impact rings, paddle recoil, hit-stop, speed lines.
  - Accessibility toggles: Reduced Effects, Reduced Motion, Sound Volume sliders.

### v1.7.0 — Distinctive Gameplay Identity (MINOR)
- **Objective**: Signature mechanical depth for high-skill competitive play.
- **Key Deliverables**:
  - Server-authoritative physics classification identifying Smash, Curve, Counter / Parry, and Drive.
  - Overdrive collectible powerup orb supercharging paddles with cyber emerald energy.
  - Dynamic on-court typography badges with kinetic pop and fade animations.
  - Zero-latency procedural Web Audio synthesizer with dedicated sweeps and harmonic signatures.
  - Backward-compatible bit-packed binary protocol for skill shots and overdrive flags.

### v1.8.0 — Player Profiles, Ranked & Retention (MINOR)
- **Objective**: Competitive progression, anonymous player identity, and durable player records.
- **Key Deliverables**:
  - Persistent player profiles with PvP stats (wins, losses, win rate, peak speed, streaks, skill shots).
  - Symmetrical Elo rating engine ($K=32$) and six rank tiers (Bronze, Silver, Gold, Platinum, Diamond, Master).
  - Profile modal dashboard, rank tier progression bar, combat stats, and match history.
  - Progression achievements rewarding match milestones and skill shot mastery.
  - Dual backend parity across PostgreSQL and in-memory repositories.

### v1.9.0 — Social Multiplayer & Population Loop (MINOR)
- **Objective**: Minimize human matchmaking drop-off and maximize community retention through mutual rematches, spectator cheer reactions, warmups, and friction-free social invites.
- **Key Deliverables**:
  - Mutual Rematch Consent Flow: 15-second dual acceptance countdown for 2-player matches with instant reset upon consent, leave-room decline, and zero-wait instant replay for solo AI games.
  - Spectator Cheers & Live Reactions: Real-time floating emojis (`👏`, `🔥`, `⚡`, `🚀`, `🎯`) with server rate-limiting and cross-gateway pub/sub broadcast.
  - Background AI Warmup Matchmaking: Instant on-court AI warm-up match while queueing for online opponents, hot-swapping into multiplayer when found.
  - Direct Link Room Sharing: Web Share API with clipboard fallback, deep-link query parameter parsing (`?join=CODE&role=player`), and frictionless room joins.

### v1.10.0 — Sharing, Replays & Discoverability (MINOR)
- **Objective**: Organic discovery and voluntary social sharing through high-resolution result cards, deterministic match replays, and rich OpenGraph/SEO metadata.
- **Key Deliverables**:
  - High-Resolution Match Result Cards: 1200×630 off-screen canvas generator creating dark cyberpunk post-match cards with one-click clipboard image copy (`navigator.clipboard.write`), PNG file download, and native device share sheet integration.
  - Deterministic Compact Match Replay Engine: In-browser ~15 Hz keyframe recording (~25–35 KB per match), 60+ FPS interpolated playback HUD with interactive timeline scrubber, variable playback speeds (`0.5x`, `1x`, `2x`), local replay history library in `localStorage`, and portable JSON file export/import.
  - Rich OpenGraph & SEO Metadata: Complete social preview meta cards (`og:title`, `og:description`, `og:image`, `twitter:card`), dedicated 1200×630 cyberpunk social card (`/og-image.png`), `VideoGame` JSON-LD structured data, enhanced PWA web manifest shortcuts, and offline service worker caching.

### v1.11.0 — Large-Scale Validation & Hardening (MINOR)
- **Objective**: Operational certification for 200+ container replicas hosting 10,000+ concurrent courts.
- **Key Deliverables**:
  - Synthetic multi-replica load benchmarks across increasing scales (`scripts/scale-benchmark.js`, `npm run test:scale`) verifying 60 Hz input packet streams and sub-16.6ms physics tick deadlines.
  - Prometheus 0.0.4 exposition format (`/metrics`) and JSON telemetry (`/metrics.json`) with zero-allocation rolling reservoir percentiles (p50, p90, p95, p99) for tick durations, client RTT, and matchmaking queue times.
  - Kubernetes HorizontalPodAutoscalers (`deploy/k3s/hpa.yaml`) scaling workers up to 200 pods with 300-second scale-down stabilization, and PodDisruptionBudgets (`deploy/k3s/pdb.yaml`).
  - Operational Capacity Runbook (`docs/RUNBOOK_CAPACITY_SCALE.md`) with mathematical bandwidth, memory, and CPU sizing models from 100 CCU to 20,000 CCU, PromQL alerting rules, and incident playbooks.
