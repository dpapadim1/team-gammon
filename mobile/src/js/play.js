import { h, mount } from '../../client/js/dom.js';
import { levelLabel, rulesFor } from '../../client/js/format.js';
import { createRoomView } from '../../client/js/views/room.js';
import { LocalNet, loadChampion } from './localServer.js';

const PREFS_KEY = 'tg.offline';
const CLOCKS = [5, 10, 15, 30, 60, 120];

const appEl = document.getElementById('app');
const toastsEl = document.getElementById('toasts');

const app = { net: null, hello: null, rules: rulesFor(), view: null, state: null, started: false, champion: null };

function toast(text, kind = 'info') {
  const el = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, text);
  toastsEl.append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { level: Number.isInteger(p.level) ? p.level : 3, minutes: CLOCKS.includes(p.minutes) ? p.minutes : 15 };
  } catch {
    return { level: 3, minutes: 15 };
  }
}

function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage can be blocked; the choice then only lasts for this visit
  }
}

function newNet() {
  const net = new LocalNet({ champion: app.champion });
  net.on('hello', (hello) => {
    app.hello = hello;
    app.rules = rulesFor(hello.rules?.id);
  });
  net.on('state', onState);
  net.on('chat:history', (p) => app.view?.setMessages(p.messages));
  net.on('chat', (m) => app.view?.addMessage(m));
  net.connect();
  return net;
}

function showSetup() {
  app.view?.destroy();
  app.view = null;
  app.state = null;
  app.started = false;
  app.net?.close();
  app.net = newNet();
  const prefs = loadPrefs();
  const hello = app.net.hello;
  const level = h('select', { id: 'offline-level' }, Object.keys(hello.botLevels).map((lv) => h('option', { value: lv, selected: Number(lv) === prefs.level }, levelLabel(hello, lv))));
  const minutes = h('select', { id: 'offline-minutes' }, CLOCKS.map((m) => h('option', { value: m, selected: m === prefs.minutes }, `${m} min per team`)));
  const start = h('button', { type: 'submit', class: 'btn primary', id: 'offline-start' }, 'Start game');
  const form = h('form', {
    class: 'stack',
    onSubmit: async (e) => {
      e.preventDefault();
      start.disabled = true;
      const choice = { level: Number(level.value), minutes: Number(minutes.value) };
      savePrefs(choice);
      try {
        await startGame(choice);
      } catch (err) {
        toast(err.message, 'error');
        start.disabled = false;
      }
    },
  },
  h('label', { for: 'offline-level' }, 'Bot strength'), level,
  h('label', { for: 'offline-minutes' }, 'Team clock'), minutes,
  start);
  mount(appEl, h('section', { class: 'card offline-setup' },
    h('h2', null, 'Play against bots'),
    h('p', null, 'You play the Top team with a bot partner against two bots. No connection is needed and nothing leaves this device.'),
    form));
  document.title = 'Team Gammon \u2013 offline';
}

async function startGame({ level, minutes }) {
  const net = app.net;
  await net.request('room:create', { name: 'Offline game', visibility: 'private', timeMinutes: minutes, incrementSec: 5 });
  await net.request('seat:claim', { seat: 't1' });
  await net.request('bot:fill', { level });
  app.started = true;
  await net.request('seat:ready', { ready: true });
}

function onState(state) {
  if (app.state && state.version <= app.state.version) return;
  app.state = state;
  if (!app.started) return;
  // A rematch brings the table back to the lobby with the same bots; start the next game straight away.
  if (state.phase === 'lobby') {
    const mine = state.you?.seat ? state.seats[state.you.seat] : null;
    if (mine && !mine.ready) app.net.request('seat:ready', { ready: true }).catch((err) => toast(err.message, 'error'));
    return;
  }
  if (!app.view) {
    app.view = createRoomView({ net: app.net, rules: app.rules, hello: app.hello, toast, leave: showSetup });
    mount(appEl, app.view.el);
  }
  app.view.update(state);
}

window.__tg = {
  get state() { return app.state; },
  get net() { return app.net; },
  get rules() { return app.rules; },
  get champion() { return app.champion; },
};

async function boot() {
  mount(appEl, h('p', { class: 'loading' }, 'Loading the bots...'));
  app.champion = await loadChampion();
  showSetup();
}

boot();
