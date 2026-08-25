# MonoRally

MonoRally is a minimal black-and-white paddle game built for speed, clean physics, and low-latency online play. It supports local AI, quick match, private rooms, 2v2 slot staging, spectators, replay, reconnect/resume, PWA install support, and compact binary WebSocket state packets.

The visual style is intentionally quiet: black court, white/gray paddles, small round balls, monospaced UI, and restrained effects.

## Demo

Play MonoRally at [mono.prefect-sys.online](https://mono.prefect-sys.online).

## Features

- Local AI mode with configurable difficulty.
- Online quick match for 1v1 and 2v2.
- Quick match fills missing seats with medium AI after the fallback window, then exposes the active match for spectators.
- Guided Play flow for practice, quick match, public rooms, and private rooms.
- Public room browser with separate waiting and in-progress views.
- Separate persistent, scrollable 1v1 and 2v2 top-ten boards ranked by verified winning returns, then misses and match time.
- Private room mode for 1v1 and 2v2.
- 2v2 staging lobby where players choose top or bottom team slots.
- Spectator support with configurable spectator limit.
- Replay button after match end.
- Temporary reconnect/resume using browser session identity.
- Server-authoritative physics.
- Binary protocol for smooth online state updates with JSON fallback for legacy clients.
- Low-latency rendering with bounded extrapolation instead of a long visual delay.
- Server-side late-input validation to prevent legitimate paddle blocks becoming false misses.
- NTP-style client/server clock synchronization and timestamped input adjudication.
- Moving-paddle momentum transfer and compact spin acceleration for curved returns.
- Swept rounded-paddle collision catches steep edge contacts without tunneling between physics ticks.
- Local-only red connection warning on the affected paddle and latency badge.
- Contextual tooltips and a first-match control coach.
- Power-ups: multi-ball, laser paddle, and EMP.
- Timed color inversion/rumble event with configurable trigger and duration.
- PWA manifest, service worker, and install prompt.
- Docker Compose deployment.

## Project Structure

```text
client/
  public/        Static PWA assets, CSS, index.html, service worker
  src/
    core/        Shared constants and browser helpers
    game/        Local AI game simulation
    network/     Browser socket client, clock sync, and protocol decoder
    platform/    Browser session/resume helpers
    rendering/   Canvas drawing, trajectory prediction, viewport layout, staging UI
    ui/          DOM collection, settings, audio

server/
  src/
    index.js             Server entry point and room orchestration
    config.js            Environment-backed runtime configuration
    http.js              Static client serving and /config.json
    connection.js        WebSocket upgrade and client lifecycle
    ws.js                Low-level WebSocket framing
    physics.js           Authoritative physics, AI, power-ups, win checks
    room-lifecycle.js    Room creation and replay reset
    broadcasting.js      State publishing, roster, room list, pruning
    serialization.js     Binary and JSON state snapshots
    input-timeline.js     Timestamp expansion and bounded paddle history
    utils.js             Shared server helpers

scripts/                 Smoke and load test helpers
tests/                   Unit and Playwright end-to-end tests
```

## Requirements

- Node.js 22 or newer
- npm
- Docker, optional but recommended for deployment

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:8787
```

## Docker

Copy the example environment file, tune it, then start the service:

```bash
cp .env.example .env
docker compose up -d --build
```

By default, Compose maps host port `18787` to container port `8787`.

```text
http://localhost:18787
```

For Cloudflare Tunnel, point your tunnel to:

```text
http://localhost:18787
```

and keep `https://mono.prefect-sys.online` in `CORS_ORIGINS`.

## Prebuilt Release Image

Every version tag publishes a signed-by-GitHub build to GitHub Container Registry for both `linux/amd64` and `linux/arm64`.

```bash
docker pull ghcr.io/chinmaykrishnroy/monorally:1.2.4
docker run --rm -p 8787:8787 --env-file .env ghcr.io/chinmaykrishnroy/monorally:1.2.4
```

For K3s, apply the version-pinned example after the GitHub Release workflow completes:

```bash
kubectl apply -f deploy/k3s/monorally.yaml
```

The first published GHCR package may need to be made public once in GitHub: repository **Packages** > **monorally** > **Package settings** > **Change visibility**. Public images can then be pulled by K3s without an image pull secret.

Leaderboard records are written to `LEADERBOARD_FILE`. Docker Compose mounts `/data` in the `monorally_data` named volume, so rebuilding or replacing the container keeps the records. Mount a PersistentVolumeClaim at `/data` when deploying to K3s.

## Continuous Delivery

GitHub Actions validates every push and pull request with syntax checks, unit tests, Chromium end-to-end tests, a WebSocket smoke test, and a Docker build. Pushing a version tag such as `v1.2.4` repeats those gates, then publishes multi-architecture images and creates the GitHub Release.

## Environment Variables

Common options:

```env
APP_HOST_PORT=18787
PORT=8787
CORS_ORIGINS=http://localhost:18787,http://127.0.0.1:18787,http://192.168.0.5:18787,https://mono.prefect-sys.online

PHYSICS_HZ=60
NETWORK_HZ=30
RENDER_DELAY_MS=25
INPUT_SEND_HZ=60
INPUT_BUFFER_LIMIT_BYTES=2048
INPUT_HISTORY_MS=500
LATE_INPUT_GRACE_MS=220
CLOCK_SYNC_INTERVAL_MS=5000
LEADERBOARD_FILE=/data/leaderboard.json
PADDLE_MAX_SPEED=4200
PADDLE_ACCELERATION=30000
PADDLE_VELOCITY_TRANSFER=0.34

BALL_SPIN_TRANSFER=0.26
BALL_SPIN_OFFSET=280
BALL_SPIN_MAX=1400
BALL_SPIN_DECAY=1.8

QUICK_MATCH_FALLBACK_MS=5000
QUICK_AI_DIFFICULTY=medium
AI_DIFFICULTY=hard

MAX_SPECTATORS=10
MAX_BALLS=10
MULTIBALL_TOTAL_1V1=2
MULTIBALL_TOTAL_2V2=4

MISS_LIMIT_1V1=5
MISS_LIMIT_2V2=8

BALL_BASE_SPEED=450
BALL_MAX_SPEED_MULTIPLIER=2.5
GAME_ACCEL_SECONDS=70

POWERUP_MIN_MS=9000
POWERUP_MAX_MS=18000
POWERUP_EFFECT_MS=5000
REJOIN_GRACE_MS=45000

COLOR_INVERT_AT_SECONDS=100
COLOR_INVERT_DURATION_MS=3000
```

## Quality Gates

```bash
npm run check
npm test
npm run test:e2e
npm run test:smoke
```

For a quick HTTP pressure check against a running server:

```bash
npm run test:load
```

Optional load-test variables:

```bash
LOAD_BASE_URL=http://127.0.0.1:8787
LOAD_CONNECTIONS=40
LOAD_DURATION_SECONDS=15
```

## Deployment Notes

- Keep `CORS_ORIGINS` strict in production.
- Use Docker Compose for a repeatable build.
- The server exposes `/config.json` so the client receives runtime tuning from the environment.
- The online protocol uses compact binary state packets for modern clients and JSON snapshots for compatibility.
- Paddle updates use a nine-byte application payload: type, quantized position, sequence, and synchronized timestamp. When a connection is congested, replaceable input is dropped instead of queued behind stale movement.
- Browsers cannot use raw UDP directly. MonoRally keeps broad browser and Cloudflare Tunnel compatibility with WebSockets, while fixing latency at the prediction and collision-validation layers.
- See [docs/networking.md](./docs/networking.md) for the packet layout, clock model, prediction rules, and future WebTransport path.

## License

MIT License. See [LICENSE](./LICENSE).
