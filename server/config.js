import { QUADRANT_PLAKOTO_4P } from '../engine/index.js';

const DEFAULTS = {
  host: '0.0.0.0',
  port: 3000,
  dataDir: 'data',
  dbFile: null,
  variant: QUADRANT_PLAKOTO_4P,
  trustProxy: 0,
  allowedOrigins: [],
  sessionMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  chatRetentionDays: 30,
  roomIdleMs: 5 * 60 * 1000,
  rollDice: null,
  timing: { startDelayMs: 1200, rollDelayMs: 700, passDelayMs: 1600, botThinkMs: 900 },
  game: { timeMinutes: 15, incrementSec: 5 },
  // Milliseconds per clock minute and second; tests shrink them to exercise flagging quickly.
  clockUnits: { minuteMs: 60000, secondMs: 1000 },
  limits: { roomsTotal: 300, roomsPerUser: 3, membersPerRoom: 60, chatMessages: 100, socketsPerUser: 8 },
  // Scrypt cost, N=2^15 r=8 p=3 is the OWASP-recommended configuration using about 32 MiB.
  passwordCost: { N: 2 ** 15, r: 8, p: 3 },
  rate: { authPer15Min: 30, registerPerHour: 10, guestPerHour: 30, apiPerMin: 300 },
};

function envInt(env, name, fallback) {
  if (env[name] === undefined || env[name] === '') return fallback;
  const n = Number(env[name]);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

// Environment first, then explicit overrides (used by tests); nested option groups are merged one level deep.
export function buildConfig(env = process.env, overrides = {}) {
  const production = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET ?? '';
  if (production && secret.length < 32) throw new Error('SESSION_SECRET with at least 32 characters is required in production');

  const base = {
    ...DEFAULTS,
    production,
    host: env.HOST ?? DEFAULTS.host,
    port: envInt(env, 'PORT', DEFAULTS.port),
    dataDir: env.DATA_DIR ?? DEFAULTS.dataDir,
    trustProxy: envInt(env, 'TRUST_PROXY', DEFAULTS.trustProxy),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    sessionSecret: secret || 'development-only-secret-do-not-use-in-production',
    secureCookies: production && env.INSECURE_COOKIE !== '1',
  };
  const merged = { ...base, ...overrides };
  for (const key of ['timing', 'game', 'clockUnits', 'limits', 'passwordCost', 'rate']) {
    merged[key] = { ...DEFAULTS[key], ...(overrides[key] ?? {}) };
  }
  return Object.freeze(merged);
}
