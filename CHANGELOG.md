# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
