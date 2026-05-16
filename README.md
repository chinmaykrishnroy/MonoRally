# MonoRally

MonoRally is a minimal black-and-white paddle game built for speed, clean physics, and low-latency online play. It supports local AI, quick match, private rooms, 2v2 slot staging, spectators, replay, reconnect/resume, PWA install support, and compact binary WebSocket state packets.

The visual style is intentionally quiet: black court, white/gray paddles, small round balls, monospaced UI, and restrained effects.

## Demo

Play MonoRally at [monorally.prefect-sys.online](https://monorally.prefect-sys.online).

## Features

- Local AI mode with configurable difficulty.
- Online quick match for 1v1 and 2v2.
- Quick match fills missing 2v2 seats with medium AI after the fallback window.
- Private room mode for 1v1 and 2v2.
- 2v2 staging lobby where players choose top or bottom team slots.
- Spectator support with configurable spectator limit.
- Replay button after match end.
- Temporary reconnect/resume using browser session identity.
- Server-authoritative physics.
- Binary protocol for smooth online state updates with JSON fallback for legacy clients.
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
    network/     Browser socket client and protocol decoder
    platform/    Browser session/resume helpers
    rendering/   Canvas renderer, interpolation, staging UI, effects
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

and keep `https://qq.prefect-sys.online` in `CORS_ORIGINS`.

## Environment Variables

Common options:

```env
APP_HOST_PORT=18787
PORT=8787
CORS_ORIGINS=http://localhost:18787,http://127.0.0.1:18787,https://qq.prefect-sys.online

PHYSICS_HZ=60
NETWORK_HZ=30
RENDER_DELAY_MS=90

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

## License

MIT License. See [LICENSE](./LICENSE).
