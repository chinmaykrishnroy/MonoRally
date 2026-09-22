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
| **v1.6.0** | Current Release | Premium UX/UI & Visual Identity | Accent color system, velocity trails, squash/stretch, hit-stop, accessibility |
| **v1.7.0** | Next Milestone | Distinctive Gameplay Identity | Signature skill shots (curve, counter, smash, drive), tactical powerup plays |
| **v1.8.0** | Planned | Player Profiles, Ranked & Retention | Persistent anonymous identity, Elo matchmaking, match history, personal bests |
| **v1.9.0** | Planned | Social Multiplayer & Population Loop | Background human matchmaking during AI warmup, mutual rematches, invites |
| **v1.10.0** | Planned | Sharing, Replays & Discoverability | Compact deterministic replays, shareable result cards, OpenGraph / SEO |
| **v1.11.0** | Planned | Large-Scale Validation & Hardening | Synthetic load tests (up to 200 replicas), telemetry metrics, capacity profiling |

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
  - Distinct shot mechanics: neutral return, angled drive, fast swipe, curve, counter-spin, smash.
  - Tactical powerup placement with skill-oriented acquisition.

### v1.8.0 — Player Profiles, Ranked & Retention (MINOR)
- **Objective**: Competitive progression and durable player records.
- **Key Deliverables**:
  - Persistent player profiles with PvP stats (wins, losses, win rate, peak speed, streaks).
  - Segregated Elo ranking for ranked human PvP.
  - Non-pay-to-play cosmetic progression (paddle themes, court visual accents).

### v1.9.0 — Social Multiplayer & Population Loop (MINOR)
- **Objective**: Minimize human matchmaking drop-off and maximize community retention.
- **Key Deliverables**:
  - Seamless matchmaking: queue for human opponent while playing AI warmup, transitioning cleanly upon match found.
  - Post-match rematch consent, room share links, spectator mode enhancements.

### v1.10.0 — Sharing, Replays & Discoverability (MINOR)
- **Objective**: Organic discovery and voluntary social sharing.
- **Key Deliverables**:
  - High-resolution match result cards ready for one-click clipboard/social share.
  - Deterministic compact match replay recording and playback.
  - Polished OpenGraph preview cards, web app manifest, SEO metadata.

### v1.11.0 — Large-Scale Validation & Hardening (MINOR)
- **Objective**: Operational certification for 200+ container replicas.
- **Key Deliverables**:
  - Synthetic multi-replica load benchmarks across increasing scales.
  - Latency percentiles (p95/p99) and CPU/memory profiles per room.
  - Operational capacity runbook and autoscaling thresholds tuning.
