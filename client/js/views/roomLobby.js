import { Position } from '../../../engine/index.js';
import { h, mount } from '../dom.js';
import { levelLabel } from '../format.js';
import { buildScene } from '../scene.js';
import { checkerIcon, renderBoard } from '../render.js';
import { TEAM_NAMES, seatStyle } from '../seats.js';
import { deriveView } from '../viewmodel.js';

// The table before the game starts: seats, bots, settings and the invite link.
export function createRoomLobby({ net, rules, hello, toast, chatEl, leave }) {
  const infoById = new Map((hello?.rules?.seats ?? []).map((s) => [s.id, s]));
  const levels = Object.keys(hello?.botLevels ?? { 3: 'Bot' });
  let botLevel = 3;
  let state = null;
  let view = null;
  let previewTeam = null;

  const act = async (event, payload) => {
    try {
      await net.request(event, payload);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const levelSelect = (value, id) => h('select', { 'aria-label': 'Bot strength', id, onChange: (e) => { botLevel = Number(e.target.value); } },
    levels.map((lv) => h('option', { value: lv, selected: Number(lv) === Number(value) }, levelLabel(hello, lv))));

  // Head: name, invite link
  const head = h('section', { class: 'card room-head' });
  const invite = h('input', { readonly: true, 'aria-label': 'Invite link', class: 'invite', onFocus: (e) => e.target.select() });
  const copied = h('span', { class: 'hint' });
  const inviteRow = h('div', { class: 'row' }, invite,
    h('button', {
      type: 'button',
      class: 'btn small',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(invite.value);
          copied.textContent = 'Copied';
        } catch {
          invite.select();
          copied.textContent = 'Press Ctrl+C to copy';
        }
      },
    }, 'Copy link'),
    copied);

  const seatsEl = h('section', { class: 'seats-grid' });
  const statusEl = h('p', { class: 'status', id: 'start-status' });
  const hostEl = h('section', { class: 'card host-controls' });
  const previewEl = h('section', { class: 'card preview' });

  // Host settings form is built once so typing is not interrupted by state updates.
  const sName = h('input', { id: 'set-name', maxlength: 40, autocomplete: 'off' });
  const sVis = h('select', { id: 'set-visibility' }, h('option', { value: 'public' }, 'Public'), h('option', { value: 'private' }, 'Private'));
  const sMin = h('input', { id: 'set-minutes', type: 'number', min: 1, max: 120 });
  const sInc = h('input', { id: 'set-increment', type: 'number', min: 0, max: 60 });
  const settings = h('form', {
    class: 'stack',
    onSubmit: (e) => {
      e.preventDefault();
      act('room:settings', { name: sName.value.trim() || undefined, visibility: sVis.value, timeMinutes: Number(sMin.value), incrementSec: Number(sInc.value) });
    },
  },
  h('h3', null, 'Table settings'),
  h('label', { for: 'set-name' }, 'Name'), sName,
  h('label', { for: 'set-visibility' }, 'Who can find it'), sVis,
  h('div', { class: 'row split' },
    h('div', null, h('label', { for: 'set-minutes' }, 'Clock (min)'), sMin),
    h('div', null, h('label', { for: 'set-increment' }, 'Per turn (s)'), sInc)),
  h('button', { type: 'submit', class: 'btn small' }, 'Save settings'));

  function syncSettings(room) {
    if (settings.contains(document.activeElement)) return;
    sName.value = room.name;
    sVis.value = room.visibility;
    sMin.value = room.timeMinutes;
    sInc.value = room.incrementSec;
  }

  const fillSelect = levelSelect(botLevel, 'fill-level');
  const hostPanel = h('div', { class: 'stack' },
    h('h3', null, 'Bots'),
    h('div', { class: 'row' }, fillSelect, h('button', { type: 'button', class: 'btn small', id: 'fill-bots', onClick: () => act('bot:fill', { level: Number(fillSelect.value) }) }, 'Fill empty seats')),
    settings);

  function seatCard(id) {
    const seat = state.seats[id];
    const mine = view.mySeat === id;
    const info = infoById.get(id);
    const st = seatStyle(id);
    let occupant;
    if (!seat) occupant = h('span', { class: 'muted' }, 'Empty seat');
    else if (seat.kind === 'bot') occupant = h('span', null, 'Bot ', h('span', { class: 'muted' }, hello?.botLevels?.[seat.level] ?? `level ${seat.level}`), hello?.botRatings?.[seat.level] ? h('span', { class: 'muted rating' }, ` ${hello.botRatings[seat.level]}`) : null);
    else occupant = h('span', null, seat.name, typeof seat.rating === 'number' ? h('span', { class: 'muted rating', title: 'Rating' }, ` ${seat.rating}`) : null, mine ? ' (you)' : '', seat.name === state.room.host ? ' (host)' : '');

    const actions = [];
    if (mine) {
      actions.push(h('button', { type: 'button', class: `btn small${seat.ready ? '' : ' primary'}`, id: 'ready-btn', onClick: () => act('seat:ready', { ready: !seat.ready }) }, seat.ready ? 'Not ready' : 'Ready'));
      actions.push(h('button', { type: 'button', class: 'btn small', onClick: () => act('seat:release', { seat: id }) }, 'Stand up'));
    } else if (!seat || seat.kind === 'bot') {
      actions.push(h('button', { type: 'button', class: 'btn small', 'data-claim': id, onClick: () => act('seat:claim', { seat: id }) }, 'Sit here'));
    }
    if (view.isHost && (!seat || seat.kind === 'bot')) {
      const select = levelSelect(seat?.level ?? botLevel);
      actions.push(select, h('button', { type: 'button', class: 'btn small', onClick: () => act('bot:set', { seat: id, level: Number(select.value) }) }, seat ? 'Change' : 'Add bot'));
      if (seat) actions.push(h('button', { type: 'button', class: 'btn small danger', onClick: () => act('bot:set', { seat: id, level: null }) }, 'Remove'));
    }

    return h('div', { class: `seat-card${mine ? ' mine' : ''}`, 'data-seat': id, style: `--seat:${st.mid}` },
      checkerIcon(id, 38),
      h('div', { class: 'seat-body' },
        h('div', { class: 'seat-title' }, `${st.name} ${id.slice(1)}`),
        h('div', { class: 'seat-name' }, occupant),
        info ? h('div', { class: 'hint' }, `Starts on point ${info.start}, moves ${info.dir < 0 ? 'down' : 'up'}`) : null,
        seat?.kind === 'human' ? h('div', { class: 'flags' },
          h('span', { class: `flag ${seat.ready ? 'ok' : 'wait'}` }, seat.ready ? 'Ready' : 'Not ready'),
          seat.connected ? null : h('span', { class: 'flag off' }, 'Offline')) : null,
        h('div', { class: 'seat-actions' }, actions)));
  }

  function status() {
    if (view.humans.length === 0) return 'Take a seat to start. At least one person has to play.';
    if (!view.full) {
      const free = rules.seatIds.filter((id) => !state.seats[id]).length;
      return `Waiting for ${free} more seat${free === 1 ? '' : 's'} to be taken${view.isHost ? ' (the host can add bots)' : ''}.`;
    }
    if (!view.everyoneReady) {
      const waiting = view.humans.filter((id) => !state.seats[id].ready).map((id) => state.seats[id].name);
      return `Waiting for ${waiting.join(', ')} to be ready.`;
    }
    return 'Everyone is ready. The game is starting.';
  }

  function render() {
    const room = state.room;
    mount(head,
      h('h2', null, room.name),
      h('div', { class: 'muted' }, `Hosted by ${room.host} \u00b7 ${room.timeMinutes} min per team + ${room.incrementSec} s per turn \u00b7 ${room.visibility === 'public' ? 'public' : 'private'} \u00b7 ${state.spectators} watching`),
      h('label', { class: 'label-inline' }, 'Invite link'),
      inviteRow);
    invite.value = `${location.origin}/#/room/${room.id}`;
    mount(seatsEl, [0, 1].map((team) => h('div', { class: `team-box team-${team}` },
      h('h3', null, `${TEAM_NAMES[team]} team`),
      rules.teamSeats[team].map((s) => seatCard(rules.seatIds[s])))));
    statusEl.textContent = status();
    syncSettings(room);
    hostEl.hidden = !view.isHost;
    if (previewTeam !== view.viewTeam) {
      previewTeam = view.viewTeam;
      mount(previewEl, h('h3', null, 'Starting position'),
        renderBoard(buildScene({ rules, position: Position.initial(rules), viewTeam: view.viewTeam }), {}, 'Starting position'),
        h('p', { class: 'hint' }, 'Each player starts in a corner with eight checkers and runs to the home board in the same half. Turn order is drawn when the game starts.'));
    }
  }

  mount(hostEl, hostPanel);
  const left = h('div', { class: 'col' }, head, seatsEl, h('div', { class: 'card' }, statusEl, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', id: 'leave-table', onClick: leave }, 'Leave table'))), hostEl);
  const right = h('div', { class: 'col' }, previewEl, chatEl);
  const el = h('div', { class: 'room-lobby' }, left, right);

  return {
    el,
    update(next) {
      state = next;
      view = deriveView(next, rules);
      render();
    },
    destroy() {},
  };
}
