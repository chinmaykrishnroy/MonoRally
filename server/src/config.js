import { envNumber, envText } from "./env.js";

export const W = 1000;
export const H = 680;
export const PHYSICS_HZ = envNumber("PHYSICS_HZ", 60, 30, 240);
export const NETWORK_HZ = envNumber("NETWORK_HZ", 30, 10, 60);
export const PORT = envNumber("PORT", 8787, 1024, 65535);
export const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || "./data/leaderboard.json";
export const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ||
  `http://localhost:${PORT},http://127.0.0.1:${PORT},https://mono.prefect-sys.online`)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
export const QUICK_MATCH_FALLBACK_MS = envNumber("QUICK_MATCH_FALLBACK_MS", 5000, 1000, 30000);
export const MAX_SPECTATORS = envNumber("MAX_SPECTATORS", 10, 0, 100);
export const PUBLIC_ROOM_PAGE_SIZE = envNumber("PUBLIC_ROOM_PAGE_SIZE", 10, 2, 50);
export const MAX_BALLS = envNumber("MAX_BALLS", 10, 1, 24);
export const WEBSOCKET_MAX_MESSAGE_BYTES = envNumber("WEBSOCKET_MAX_MESSAGE_BYTES", 16 * 1024, 1024, 256 * 1024);
export const HEARTBEAT_MS = envNumber("HEARTBEAT_MS", 15000, 5000, 60000);
export const CLIENT_TIMEOUT_MS = envNumber("CLIENT_TIMEOUT_MS", 45000, 10000, 180000);
export const INPUT_RATE_LIMIT_PER_SECOND = envNumber("INPUT_RATE_LIMIT_PER_SECOND", 160, 30, 1000);
export const INPUT_HISTORY_MS = envNumber("INPUT_HISTORY_MS", 500, 100, 2000);
export const LATE_INPUT_GRACE_MS = envNumber("LATE_INPUT_GRACE_MS", 220, 0, 500);
export const INPUT_FUTURE_TOLERANCE_MS = envNumber("INPUT_FUTURE_TOLERANCE_MS", 40, 0, 200);
export const INPUT_SEND_HZ = envNumber("INPUT_SEND_HZ", 60, 20, 120);
export const INPUT_BUFFER_LIMIT_BYTES = envNumber("INPUT_BUFFER_LIMIT_BYTES", 2048, 256, 65536);
export const CLOCK_SYNC_INTERVAL_MS = envNumber("CLOCK_SYNC_INTERVAL_MS", 5000, 1000, 30000);
export const HIT_PRESENTATION_DELAY_MS = envNumber("HIT_PRESENTATION_DELAY_MS", 90, 30, 250);
export const PADDLE_MAX_SPEED = envNumber("PADDLE_MAX_SPEED", 4200, 500, 12000);
export const PADDLE_ACCELERATION = envNumber("PADDLE_ACCELERATION", 30000, 1000, 100000);
export const PADDLE_VELOCITY_TRANSFER = envNumber("PADDLE_VELOCITY_TRANSFER", 0.34, 0, 1);
export const BALL_SPIN_TRANSFER = envNumber("BALL_SPIN_TRANSFER", 0.26, 0, 1);
export const BALL_SPIN_OFFSET = envNumber("BALL_SPIN_OFFSET", 280, 0, 2000);
export const BALL_SPIN_MAX = envNumber("BALL_SPIN_MAX", 1400, 0, 5000);
export const BALL_SPIN_DECAY = envNumber("BALL_SPIN_DECAY", 1.8, 0, 10);
export const MISS_LIMIT_1V1 = envNumber("MISS_LIMIT_1V1", 5, 1, 99);
export const MISS_LIMIT_2V2 = envNumber("MISS_LIMIT_2V2", 8, 1, 99);
export const BALL_BASE_SPEED = envNumber("BALL_BASE_SPEED", 450, 120, 1600);
export const BALL_MAX_SPEED_MULTIPLIER = envNumber("BALL_MAX_SPEED_MULTIPLIER", 2.5, 1, 8);
export const GAME_ACCEL_SECONDS = envNumber("GAME_ACCEL_SECONDS", 70, 10, 300);
export const POWERUP_MIN_MS = envNumber("POWERUP_MIN_MS", 9000, 1000, 120000);
export const POWERUP_MAX_MS = Math.max(POWERUP_MIN_MS, envNumber("POWERUP_MAX_MS", 18000, 1000, 120000));
export const POWERUP_EFFECT_MS = envNumber("POWERUP_EFFECT_MS", 5000, 1000, 30000);
export const MULTIBALL_TOTAL_1V1 = envNumber("MULTIBALL_TOTAL_1V1", 2, 1, MAX_BALLS);
export const MULTIBALL_TOTAL_2V2 = envNumber("MULTIBALL_TOTAL_2V2", 4, 2, MAX_BALLS);
export const REJOIN_GRACE_MS = envNumber("REJOIN_GRACE_MS", 45000, 5000, 300000);
export const COLOR_INVERT_AT_SECONDS = envNumber("COLOR_INVERT_AT_SECONDS", 100, 1, 3600);
export const COLOR_INVERT_DURATION_MS = envNumber("COLOR_INVERT_DURATION_MS", 3000, 250, 30000);
export const QUICK_AI_DIFFICULTY = envText("QUICK_AI_DIFFICULTY", "medium", ["easy", "medium", "normal", "hard", "insane"]);
export const TICK = 1000 / PHYSICS_HZ;
export const STATE_PACKET = 2;
export const SCORED_STATE_PACKET = 3;
export const INPUT_PACKET = 1;

export function publicConfig() {
  return {
    appVersion: process.env.APP_VERSION || "1.2.5",
    aiDifficulty: envText("AI_DIFFICULTY", "hard", ["easy", "medium", "hard", "insane"]),
    renderDelayMs: envNumber("RENDER_DELAY_MS", 25, 0, 100),
    quickMatchFallbackMs: QUICK_MATCH_FALLBACK_MS,
    quickAiDifficulty: QUICK_AI_DIFFICULTY,
    maxSpectators: MAX_SPECTATORS,
    publicRoomPageSize: PUBLIC_ROOM_PAGE_SIZE,
    maxBalls: MAX_BALLS,
    multiballTotal1v1: MULTIBALL_TOTAL_1V1,
    multiballTotal2v2: MULTIBALL_TOTAL_2V2,
    powerupEffectMs: POWERUP_EFFECT_MS,
    missLimit1v1: MISS_LIMIT_1V1,
    missLimit2v2: MISS_LIMIT_2V2,
    colorInvertAtSeconds: COLOR_INVERT_AT_SECONDS,
    colorInvertDurationMs: COLOR_INVERT_DURATION_MS,
    inputRateLimitPerSecond: INPUT_RATE_LIMIT_PER_SECOND,
    inputSendHz: INPUT_SEND_HZ,
    inputBufferLimitBytes: INPUT_BUFFER_LIMIT_BYTES,
    lateInputGraceMs: LATE_INPUT_GRACE_MS,
    clockSyncIntervalMs: CLOCK_SYNC_INTERVAL_MS,
    hitPresentationDelayMs: HIT_PRESENTATION_DELAY_MS,
    paddleMaxSpeed: PADDLE_MAX_SPEED,
    paddleAcceleration: PADDLE_ACCELERATION,
    paddleVelocityTransfer: PADDLE_VELOCITY_TRANSFER,
    ballSpinTransfer: BALL_SPIN_TRANSFER,
    ballSpinOffset: BALL_SPIN_OFFSET,
    ballSpinMax: BALL_SPIN_MAX,
    ballSpinDecay: BALL_SPIN_DECAY,
    networkHz: NETWORK_HZ,
    physicsHz: PHYSICS_HZ
  };
}
