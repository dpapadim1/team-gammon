import { api } from './api.js';
import { Net } from './net.js';
import { h, mount } from './dom.js';
import { deriveView } from './viewmodel.js';
import { rulesFor } from './format.js';
import { createAuthView } from './views/auth.js';
import { createLobbyView } from './views/lobby.js';
import { createRoomView } from './views/room.js';

const appEl = document.getElementById('app');
const headerEl = document.getElementById('top');
const toastsEl = document.getElementById('toasts');
const statusEl = document.getElementById('connection');

// Inside the iOS app (mobile/) this site runs in the app's web view: pages open in place and the logo leads back to the app.
const IN_APP = /\bTeamGammonApp\//.test(navigator.userAgent);
const APP_HOME = 'capacitor://localhost/index.html';
if (IN_APP) {
  document.addEventListener('click', (e) => e.target.closest?.('a[target="_blank"]')?.removeAttribute('target'), true);
}

const app = {
  user: null,
  hello: null,
  rules: rulesFor(),
  net: null,
  state: null,
  messages: [],
  kind: null,
  active: null,
  roomId: null,
  joining: null,
  leaving: false,
};

function toast(text, kind = 'info') {
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  toastsEl.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

function renderHeader() {
  const rating = typeof app.user?.rating === 'number' ? h('span', { class: 'rating', id: 'my-rating', title: 'Your rating' }, app.user.rating) : null;
  mount(headerEl,
    h('a', { class: 'brand', href: IN_APP ? APP_HOME : '#/' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '\u25cf\u25cf'), 'Team Gammon'),
    h('nav', null,
      h('a', { class: 'nav-extra', href: '/puzzles', target: '_blank', rel: 'noopener' }, 'Puzzles'),
      h('a', { class: 'nav-extra', href: '/leaderboard', target: '_blank', rel: 'noopener' }, 'Leaderboard'),
      h('a', { href: '/rules', target: '_blank', rel: 'noopener' }, 'Rules'),
      app.user ? h('span', { class: 'who', id: 'whoami' }, app.user.username, rating, app.user.guest ? ' (guest)' : '') : null,
      app.user ? h('button', { type: 'button', class: 'btn small', id: 'sign-out', onClick: signOut }, 'Sign out') : null));
}

function show(kind, view, id = null) {
  app.active?.destroy?.();
  app.kind = kind;
  app.active = view;
  app.roomId = id;
  mount(appEl, view.el);
  view.activate?.();
}

function showLoading(text) {
  show('loading', { el: h('p', { class: 'loading' }, text) });
  document.title = 'Team Gammon';
}

function showAuth() {
  if (app.kind === 'auth') return;
  show('auth', createAuthView({ api, onSignedIn }));
  document.title = 'Team Gammon \u2013 sign in';
}

function showLobby() {
  show('lobby', createLobbyView({ api, net: app.net, hello: app.hello, user: app.user, toast, navigate }));
  document.title = 'Team Gammon';
}

function showRoom() {
  const state = app.state;
  if (app.kind !== 'room' || app.roomId !== state.room.id) {
    const view = createRoomView({ net: app.net, rules: app.rules, hello: app.hello, toast, leave: () => navigate('#/') });
    show('room', view, state.room.id);
    view.setMessages(app.messages);
  }
  app.active.update(state);
  const mine = deriveView(state, app.rules).myTurn;
  document.title = `${mine ? '\u25cf Your turn \u2013 ' : ''}${state.room.name} \u2013 Team Gammon`;
}

function parseRoute() {
  const match = location.hash.match(/^#\/room\/([a-z2-9]{8})$/);
  return match ? { name: 'room', id: match[1] } : { name: 'lobby' };
}

function navigate(hash) {
  if (location.hash === hash) sync();
  else location.hash = hash;
}

async function joinRoom(id) {
  if (app.joining === id) return;
  app.joining = id;
  app.messages = [];
  showLoading('Joining the table...');
  try {
    await app.net.request('room:join', { roomId: id });
  } catch (err) {
    toast(err.message, 'error');
    app.joining = null;
    location.hash = app.state ? `#/room/${app.state.room.id}` : '#/';
    return;
  }
  app.joining = null;
}

async function leaveRoom() {
  if (app.leaving) return;
  app.leaving = true;
  app.messages = [];
  try {
    await app.net.request('room:leave');
  } catch (err) {
    app.leaving = false;
    toast(err.message, 'error');
    if (app.state) location.hash = `#/room/${app.state.room.id}`;
    return;
  }
  app.leaving = false;
  app.state = null;
  showLobby();
}

// Brings the screen in line with the address and the server state.
function sync() {
  if (!app.user) return showAuth();
  if (!app.hello) return showLoading('Connecting...');
  const route = parseRoute();
  if (route.name === 'room') {
    if (app.state?.room.id === route.id) return showRoom();
    return joinRoom(route.id);
  }
  if (app.state) return leaveRoom();
  if (app.kind !== 'lobby') showLobby();
  return undefined;
}

// A finished rated game carries the new rating in its result; keep the header in step.
function trackRating(state) {
  const mine = state.game?.result?.ratings?.[state.you?.seat];
  if (!mine || !app.user || app.user.rating === mine.after) return;
  app.user.rating = mine.after;
  renderHeader();
}

function onState(next) {
  const cur = app.state;
  if (cur && cur.room.id === next.room.id && next.version <= cur.version) return;
  app.state = next;
  trackRating(next);
  if (app.leaving) return;
  const want = `#/room/${next.room.id}`;
  if (location.hash !== want) location.hash = want;
  else showRoom();
}

function onHello(hello) {
  app.hello = hello;
  app.rules = rulesFor(hello.rules?.id);
  if (app.state) {
    // Back after a dropped connection: join the table again quietly.
    app.net.request('room:join', { roomId: app.state.room.id }).catch(() => {
      app.state = null;
      app.messages = [];
      sync();
    });
  } else {
    sync();
  }
}

function startNet() {
  if (typeof window.io !== 'function') {
    showLoading('The realtime connection library did not load. Please reload the page.');
    return;
  }
  const net = new Net(() => window.io());
  app.net = net;
  net.on('status', (status) => {
    statusEl.hidden = status === 'online';
  });
  net.on('refused', (code) => {
    if (code === 'auth_required') {
      stopNet();
      app.user = null;
      renderHeader();
      showAuth();
    } else {
      toast('This account has too many open tabs.', 'error');
      showLoading('Too many open tabs for this account.');
    }
  });
  net.on('hello', onHello);
  net.on('state', onState);
  net.on('chat:history', ({ messages }) => {
    app.messages = messages;
    if (app.kind === 'room') app.active.setMessages(messages);
  });
  net.on('chat', (message) => {
    app.messages.push(message);
    if (app.kind === 'room') app.active.addMessage(message);
  });
  net.connect();
}

function stopNet() {
  app.net?.close();
  app.net = null;
  app.hello = null;
  app.state = null;
  app.messages = [];
  app.joining = null;
  app.leaving = false;
  statusEl.hidden = true;
}

function onSignedIn(user) {
  app.user = user;
  renderHeader();
  startNet();
  sync();
}

async function signOut() {
  try {
    await api.logout();
  } catch (err) {
    toast(err.message, 'error');
  }
  stopNet();
  app.user = null;
  renderHeader();
  location.hash = '#/';
  showAuth();
}

async function boot() {
  renderHeader();
  showLoading('Loading...');
  try {
    app.user = await api.me();
  } catch (err) {
    if (err.code !== 'auth_required') {
      showLoading(err.message);
      return;
    }
  }
  renderHeader();
  window.addEventListener('hashchange', sync);
  if (app.user) startNet();
  sync();
}

// Handle for end-to-end tests and debugging in the console.
window.__tg = {
  get app() { return app; },
  get state() { return app.state; },
  get user() { return app.user; },
  get rules() { return app.rules; },
  get room() { return app.kind === 'room' ? app.active : null; },
};

boot();
