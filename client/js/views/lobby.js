import { h, mount } from '../dom.js';
import { levelLabel, signed } from '../format.js';

const CODE = /[a-z2-9]{8}/;

function outcome(game) {
  if (game.reason === 'abandoned') return 'Abandoned';
  if (game.winnerTeam === -1) return 'Draw';
  const mine = game.seat.startsWith('t') ? 0 : 1;
  return game.winnerTeam === mine ? 'Won' : 'Lost';
}

const REASONS = { bearoff: 'all checkers home', timeout: 'on time', resign: 'resigned', deadlock: 'blocked', abandoned: 'server restart', error: 'error' };

// Start screen: quick game, create or join a table, list of open tables, and recent games of registered users.
export function createLobbyView({ api, net, hello, user, toast, navigate }) {
  let timer = null;
  let busy = false;
  const levels = Object.keys(hello?.botLevels ?? { 3: 'Bot' });

  const levelSelect = (id, value) => h('select', { id }, levels.map((lv) => h('option', { value: lv, selected: String(lv) === String(value) }, levelLabel(hello, lv))));
  const guard = async (task) => {
    if (busy) return;
    busy = true;
    try {
      await task();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      busy = false;
    }
  };

  const quickLevel = levelSelect('quick-level', 3);
  const quick = h('section', { class: 'card' },
    h('h2', null, 'Quick game'),
    h('p', null, 'Take a seat with three bots and start right away. Your partner is a bot too.'),
    h('div', { class: 'row' },
      h('label', { for: 'quick-level' }, 'Bot strength'),
      quickLevel,
      h('button', { type: 'button', class: 'btn primary', id: 'quick-play', onClick: () => guard(startQuick) }, 'Play now')));

  async function startQuick() {
    await net.request('room:create', { name: `${user.username}'s game`.slice(0, 40), visibility: 'private', timeMinutes: 15, incrementSec: 5 });
    await net.request('seat:claim', { seat: 't1' });
    await net.request('bot:fill', { level: Number(quickLevel.value) });
    await net.request('seat:ready', { ready: true });
  }

  const nameInput = h('input', { id: 'new-name', maxlength: 40, placeholder: `${user.username}'s table`, autocomplete: 'off' });
  const visibility = h('select', { id: 'new-visibility' }, h('option', { value: 'public' }, 'Public'), h('option', { value: 'private' }, 'Private (invite link only)'));
  const minutes = h('input', { id: 'new-minutes', type: 'number', min: 1, max: 120, value: 15 });
  const increment = h('input', { id: 'new-increment', type: 'number', min: 0, max: 60, value: 5 });
  const create = h('section', { class: 'card' },
    h('h2', null, 'Open a table'),
    h('form', {
      class: 'stack',
      onSubmit: (e) => {
        e.preventDefault();
        guard(async () => {
          const options = { visibility: visibility.value, timeMinutes: Number(minutes.value), incrementSec: Number(increment.value) };
          if (nameInput.value.trim()) options.name = nameInput.value.trim();
          await net.request('room:create', options);
        });
      },
    },
    h('label', { for: 'new-name' }, 'Table name'),
    nameInput,
    h('label', { for: 'new-visibility' }, 'Who can find it'),
    visibility,
    h('div', { class: 'row split' },
      h('div', null, h('label', { for: 'new-minutes' }, 'Team clock (minutes)'), minutes),
      h('div', null, h('label', { for: 'new-increment' }, 'Added per turn (seconds)'), increment)),
    h('button', { type: 'submit', class: 'btn primary', id: 'create-table' }, 'Create table')));

  const code = h('input', { id: 'join-code', placeholder: 'Table code or link', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Table code or link' });
  const join = h('section', { class: 'card' },
    h('h2', null, 'Join with a code'),
    h('form', {
      class: 'row',
      onSubmit: (e) => {
        e.preventDefault();
        const match = code.value.trim().toLowerCase().match(CODE);
        if (match) navigate(`#/room/${match[0]}`);
        else toast('That does not look like a table code.', 'error');
      },
    }, code, h('button', { type: 'submit', class: 'btn' }, 'Join')));

  const tables = h('ul', { class: 'tables' });
  const tablesNote = h('p', { class: 'hint' });
  const open = h('section', { class: 'card wide' },
    h('div', { class: 'row split' }, h('h2', null, 'Open tables'), h('button', { type: 'button', class: 'btn small', onClick: () => refresh() }, 'Refresh')),
    tables,
    tablesNote);

  const history = h('section', { class: 'card wide' });

  const deletePassword = h('input', { id: 'delete-password', type: 'password', autocomplete: 'current-password', maxlength: 128, required: true, placeholder: 'Your password', 'aria-label': 'Password' });
  const account = user.guest ? null : h('details', { class: 'card wide account' },
    h('summary', null, 'Delete my account'),
    h('p', { class: 'hint' }, 'This removes your account and your game history. Your name in finished games and in chat is replaced by "deleted". It cannot be undone.'),
    h('form', {
      class: 'row',
      onSubmit: (e) => {
        e.preventDefault();
        guard(async () => {
          await api.deleteAccount(deletePassword.value);
          location.reload();
        });
      },
    }, deletePassword, h('button', { type: 'submit', class: 'btn danger', id: 'delete-account' }, 'Delete account')));
  async function refresh() {
    try {
      const rooms = await api.rooms();
      mount(tables, rooms.map((r) => h('li', { class: 'table-row' },
        h('div', { class: 'grow' }, h('strong', null, r.name), h('span', { class: 'muted' }, ` hosted by ${r.host}`)),
        h('div', { class: 'muted' }, `${r.humans} player${r.humans === 1 ? '' : 's'}, ${r.bots} bot${r.bots === 1 ? '' : 's'}`),
        h('div', { class: 'muted' }, `${r.timeMinutes} min + ${r.incrementSec} s`),
        h('button', { type: 'button', class: 'btn small', onClick: () => navigate(`#/room/${r.id}`) }, r.phase === 'lobby' ? 'Join' : 'Watch'))));
      tablesNote.textContent = rooms.length ? '' : 'No public tables yet. Open one or play against bots.';
    } catch (err) {
      tablesNote.textContent = err.message;
    }
  }

  async function loadHistory() {
    if (user.guest) {
      mount(history, h('h2', null, 'Your games'), h('p', { class: 'hint' }, 'Guests have no game history. Create an account to keep yours.'));
      return;
    }
    try {
      const games = await api.games(10);
      mount(history, h('h2', null, 'Your recent games'),
        games.length === 0 ? h('p', { class: 'hint' }, 'Finished games will show up here.') : h('ul', { class: 'tables' }, games.map((g) => h('li', { class: 'table-row' },
          h('div', { class: `grow result ${outcome(g).toLowerCase()}` }, outcome(g)),
          h('div', { class: 'muted' }, REASONS[g.reason] ?? g.reason),
          g.ratingBefore == null ? null : h('div', { class: `rating-delta ${g.ratingAfter >= g.ratingBefore ? 'up' : 'down'}`, title: `Rating ${g.ratingBefore} \u2192 ${g.ratingAfter}` }, signed(g.ratingAfter - g.ratingBefore)),
          h('div', { class: 'muted' }, new Date(g.endedAt).toLocaleString())))));
    } catch (err) {
      mount(history, h('h2', null, 'Your recent games'), h('p', { class: 'hint' }, err.message));
    }
  }

  const el = h('div', { class: 'lobby' },
    h('div', { class: 'lobby-top' }, quick, create, join),
    open,
    history,
    account);

  return {
    el,
    activate() {
      refresh();
      loadHistory();
      timer = setInterval(refresh, 5000);
    },
    destroy() {
      clearInterval(timer);
    },
  };
}
