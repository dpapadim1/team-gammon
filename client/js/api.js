import { errorMessage } from './format.js';

export class ApiError extends Error {
  constructor(code, status) {
    super(errorMessage(code));
    this.code = code;
    this.status = status;
  }
}

async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('offline', 0);
  }
  if (res.status === 204) return null;
  let data = null;
  try {
    data = await res.json();
  } catch {
    // not JSON
  }
  if (!res.ok) throw new ApiError(data?.error ?? (res.status === 429 ? 'rate_limited' : `http_${res.status}`), res.status);
  return data;
}

export const api = {
  me: () => request('GET', '/api/me').then((r) => r.user),
  login: (username, password) => request('POST', '/api/login', { username, password }).then((r) => r.user),
  register: (username, password) => request('POST', '/api/register', { username, password }).then((r) => r.user),
  guest: () => request('POST', '/api/guest', {}).then((r) => r.user),
  logout: () => request('POST', '/api/logout', {}),
  deleteAccount: (password) => request('DELETE', '/api/me', { password }),
  rooms: () => request('GET', '/api/rooms').then((r) => r.rooms),
  games: (limit = 10) => request('GET', `/api/games?limit=${limit}`).then((r) => r.games),
  leaderboard: (limit = 100) => request('GET', `/api/leaderboard?limit=${limit}`),
};
