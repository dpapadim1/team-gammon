import { QUADRANT_PLAKOTO_4P, VARIANTS, compileVariant } from '../../engine/index.js';
import { TEAM_NAMES } from './seats.js';

const pad = (n) => String(n).padStart(2, '0');

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

export function describeStep([from, , to]) {
  return `${from}\u2192${to === 0 ? 'off' : to}`;
}

export function seatTitle(seatId) {
  return `${seatId[0] === 't' ? 'Top' : 'Bottom'} ${seatId.slice(1)}`;
}

export function describeTurn(last) {
  const dice = last.dice.join('-');
  if (last.passed) return `${seatTitle(last.actor)} rolled ${dice}: no legal move`;
  return `${seatTitle(last.actor)} rolled ${dice}: ${last.steps.map(describeStep).join(', ')}`;
}

export function resultText(result) {
  if (!result) return '';
  if (result.reason === 'abandoned') return 'The game was abandoned';
  if (result.winnerTeam === -1) return result.reason === 'deadlock' ? 'Draw: nobody can move any more' : 'The game ended in a draw';
  const winner = `${TEAM_NAMES[result.winnerTeam]} team`;
  const loser = `${TEAM_NAMES[1 - result.winnerTeam]} team`;
  switch (result.reason) {
    case 'bearoff': return `${winner} wins: all 16 checkers are home`;
    case 'timeout': return `${winner} wins: ${loser} ran out of time`;
    case 'resign': return `${winner} wins: ${loser} resigned`;
    case 'deadlock': return `${winner} wins: nobody could move and it has fewer pips left`;
    default: return `${winner} wins`;
  }
}

// One sentence on how the game ended, for the banner and the game-over card.
export function resultReason(result) {
  if (!result) return '';
  const loser = result.winnerTeam === 0 || result.winnerTeam === 1 ? `${TEAM_NAMES[1 - result.winnerTeam]} team` : '';
  switch (result.reason) {
    case 'abandoned': return 'The game was abandoned.';
    case 'bearoff': return 'All 16 checkers are home.';
    case 'timeout': return `The ${loser} ran out of time.`;
    case 'resign': return `The ${loser} resigned.`;
    case 'deadlock': return result.winnerTeam === -1 ? 'Nobody can move any more and the pip counts are equal.' : 'Nobody can move any more and this team has fewer pips left.';
    default: return 'The game ended after a server problem.';
  }
}

// A rating change as text: +12, −15.
export const signed = (n) => `${n < 0 ? '\u2212' : '+'}${Math.abs(n)}`;

// "3 – Easy (1077)": the bot level, its name and its rating on the same scale as the players' ratings.
export function levelLabel(hello, level) {
  const rating = hello?.botRatings?.[level];
  return `${level} \u2013 ${hello?.botLevels?.[level] ?? 'Bot'}${rating ? ` (${rating})` : ''}`;
}

const MESSAGES = {
  invalid_credentials: 'Wrong username or password.',
  username_taken: 'That name is already taken.',
  bad_username: 'Use 3-20 letters, digits or underscores. Names starting with guest, admin, root, system, support or bot are reserved.',
  bad_password: 'Passwords need 8 to 128 characters and must differ from the username.',
  rate_limited: 'Too many requests. Please wait a moment.',
  auth_required: 'Please sign in first.',
  no_room: 'That table does not exist any more.',
  bad_room: 'That is not a valid table code.',
  room_full: 'That table is full.',
  too_many_rooms: 'You already host too many tables.',
  seat_taken: 'That seat is taken.',
  no_seat: 'Take a seat first.',
  not_host: 'Only the host can do that.',
  not_lobby: 'You can only change this before the game starts.',
  in_game: 'You are in a running game. Resign first to leave.',
  human_seat: 'That seat belongs to a player.',
  not_your_turn: 'It is not your turn.',
  illegal_turn: 'That move is not allowed.',
  bad_steps: 'That move is not allowed.',
  game_over: 'The game is over.',
  no_game: 'There is no running game.',
  bad_text: 'Messages need 1 to 300 characters.',
  too_many_connections: 'Too many open tabs for this account.',
  timeout: 'The server did not answer. Please try again.',
  offline: 'You are offline. Reconnecting...',
  bad_origin: 'The request was blocked for safety.',
  bad_settings: 'Those table settings are not valid.',
  bad_level: 'Pick a bot level between 1 and 9.',
  bad_seat: 'That seat does not exist.',
  bad_request: 'The request was not valid.',
  guests_have_no_history: 'Guests have no game history. Create an account to keep yours.',
  forbidden: 'You are not allowed to do that.',
  not_found: 'Not found.',
  internal: 'The server had a problem. Please try again.',
};

export function errorMessage(code) {
  return MESSAGES[code] ?? `Something went wrong (${code}).`;
}

const cache = new Map();

export function rulesFor(variantId) {
  const id = variantId ?? QUADRANT_PLAKOTO_4P.id;
  if (!cache.has(id)) cache.set(id, compileVariant(VARIANTS[id] ?? QUADRANT_PLAKOTO_4P));
  return cache.get(id);
}
