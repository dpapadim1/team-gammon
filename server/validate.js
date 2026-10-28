import { fail } from './errors.js';

const ROOM_ID = /^[a-z2-9]{8}$/;
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const RESERVED_NAME = /^(guest|admin|root|system|support|bot)/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function int(value, min, max, code) {
  if (!Number.isInteger(value) || value < min || value > max) fail(code);
  return value;
}

// Collapses whitespace and control characters; the client must still render the result as text, never as HTML.
export function text(value, { min = 1, max, code = 'bad_text' }) {
  if (typeof value !== 'string') fail(code);
  const clean = value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length < min || clean.length > max) fail(code);
  return clean;
}

export function roomId(value) {
  if (typeof value !== 'string' || !ROOM_ID.test(value)) fail('bad_room');
  return value;
}

export function seat(value, rules) {
  if (typeof value !== 'string' || !rules.seatIndex.has(value)) fail('bad_seat');
  return value;
}

export function channel(value) {
  if (value !== 'all' && value !== 'team') fail('bad_channel');
  return value;
}

export function level(value) {
  return int(value, 1, 9, 'bad_level');
}

// Returns [{from, die}] for the engine; a turn has at most four moves (doubles).
export function steps(value, rules) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) fail('bad_steps');
  return value.map((st) => {
    if (!Array.isArray(st) || st.length !== 2) fail('bad_steps');
    return { from: int(st[0], 1, rules.N, 'bad_steps'), die: int(st[1], 1, 6, 'bad_steps') };
  });
}

export function username(value) {
  if (typeof value !== 'string' || !USERNAME.test(value) || RESERVED_NAME.test(value)) fail('bad_username');
  return value;
}

export function password(value, name = '') {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128 || value.includes('\u0000')) fail('bad_password');
  if (name && value.toLowerCase() === name.toLowerCase()) fail('bad_password');
  return value;
}

// Room options: every field is optional so the same validator serves creation and later changes.
export function roomOptions(body, { creating }) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) fail('bad_settings');
  const out = {};
  if (body.name !== undefined) out.name = text(body.name, { max: 40, code: 'bad_settings' });
  if (body.visibility !== undefined) {
    if (body.visibility !== 'public' && body.visibility !== 'private') fail('bad_settings');
    out.visibility = body.visibility;
  }
  if (body.timeMinutes !== undefined) out.timeMinutes = int(body.timeMinutes, 1, 120, 'bad_settings');
  if (body.incrementSec !== undefined) out.incrementSec = int(body.incrementSec, 0, 60, 'bad_settings');
  if (!creating && Object.keys(out).length === 0) fail('bad_settings');
  return out;
}
