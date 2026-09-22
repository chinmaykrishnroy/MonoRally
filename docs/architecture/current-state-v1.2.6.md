# MonoRally v1.2.6 Current-State Architecture

This document records the architecture that exists before the v1.2.7
stability patch. It is intentionally descriptive, not the distributed target
design.

## Process-local state

- `server/src/index.js` owns one in-memory `rooms` map and one `clients` map.
- A room contains its roster, spectators, match status, score, balls, power-up,
  countdown, input histories, reconnect reservations, and publish schedule.
- The physics, directory, and heartbeat loops are process timers. Active match
  authority therefore belongs entirely to the one Node.js process.
- Quick-match discovery scans the local room map. There is no external queue or
  cross-process room directory.

Loss of the process ends every active room, matchmaking wait, spectator
subscription, and reconnect reservation.

## Durable state

- The leaderboard is the only durable application state.
- `server/src/leaderboard.js` loads one JSON file at startup and serializes
  updates through an in-process promise chain with temporary-file replacement.
- Docker Compose stores `/data/leaderboard.json` in a named volume. The K3s
  manifest mounts the same path from a persistent volume claim.
- Rooms, sessions, match results outside the best leaderboard entry, and replay
  state are not durable.

## Room lifecycle

1. `makeRoom` creates a waiting room in the local map.
2. Players join; 2v2 private/public rooms wait for all four selected slots.
3. `startRoom` resets match state and starts a speed-scaled countdown.
4. The 60 Hz process loop advances paddles, balls, power-ups, scoring, and win
   checks. State is published at 30 Hz while running.
5. A miss is held briefly as `pendingMiss` so timestamped late input can be
   adjudicated at the original crossing time.
6. A win or explicit player departure moves the room to `ended`. Rejoin grace
   reservations are pruned periodically.
7. Quick rooms are removed shortly after ending; empty rooms are removed by the
   directory timer.

## Quick-match lifecycle

1. A client joins the first local waiting quick room for the requested mode or
   creates one.
2. The room is public while waiting and running.
3. A five-second fallback timer fills unoccupied seats with medium AI.
4. A full room starts immediately; otherwise the fallback starts it with AI.
5. The same room supports spectators, disconnect reservations, and replay while
   every required human remains connected.

The timer and queue are process-local, so another replica could not see or join
this queue in the current architecture.

## WebSocket lifecycle

- The HTTP server performs the WebSocket upgrade and creates a local client
  record.
- The custom frame parser accepts masked text/binary frames, fragmentation,
  ping/pong, size limits, and close frames.
- Control messages use JSON. Paddle input and modern state snapshots use compact
  binary packets.
- A heartbeat closes clients that stop answering. Socket `close` and `error`
  both enter the same idempotent disconnect path.
- The browser reconnects and then attempts room resume using its persisted
  session identifier and room code.

## Leaderboard lifecycle

1. A completed match records only real players on the winning team.
2. Successful rally returns rank first, then fewer misses, then duration.
3. At most 100 records are retained in memory and persisted to JSON.
4. `/leaderboard.json` returns the top ten 1v1 and 2v2 entries.
5. The browser fetches and renders both boards independently from gameplay
   traffic.

## Collision and input lifecycle

- The client samples a target position at up to 60 Hz and sends a 14-byte
  packet containing target, sequence, synchronized timestamp, observed paddle
  position/velocity, and clock-confidence flag.
- NTP-style probes estimate server clock offset, RTT, and jitter. Untrusted
  timestamps are treated as receive-time input.
- The server constrains claimed movement by maximum speed and acceleration and
  stores a bounded timestamped paddle history.
- Ball movement uses swept rounded-capsule collision. A complete approach path
  is retained across physics frames.
- If no immediately known paddle intersects, authority freezes the ball at the
  contact band, waits a bounded adaptive interval, reconstructs paddle position
  at impact, and then resolves hit or miss.
- Clients predict paddle and ball motion for presentation only; the server owns
  scoring and collision outcomes.

## Reconnect lifecycle

- The browser keeps a random session ID and last room code in local storage.
- Unexpected disconnects reserve the player slot for the configured grace
  period. The match continues and the same session can reclaim that player.
- Explicit leave removes the player immediately and can end the match by team
  presence.
- Opening the same session in another tab transfers authority to the new socket
  and invalidates the previous tab.

## Deployment lifecycle

- GitHub Actions runs syntax, unit/integration, browser, smoke, clock, and image
  validation.
- A version tag builds multi-architecture images for GHCR and creates a GitHub
  Release.
- Docker runs one non-root Node process on port 8787. Compose maps host port
  18787 and persists `/data`.
- The K3s manifest currently deploys one application replica because active
  rooms and matchmaking are not distributed.
- Cloudflare Tunnel terminates public HTTPS/WebSocket traffic and forwards it to
  the local HTTP service. Origin allowlisting is environment controlled.

## Baseline risks addressed by v1.2.7

- Reordered input was discarded before collision history could use it.
- Ended public rooms were classified as live until pruning.
- Quick-match fallback timers were not owned or cancelled by room lifecycle.
- Browser reconnect timers could outlive the socket generation that created
  them.
- Binary frame-handler exceptions could escape the guarded protocol path.
- Collision disputes lacked structured, opt-in diagnostic evidence.

PostgreSQL, Redis, and NATS are deliberately deferred until this baseline is
released and verified.
