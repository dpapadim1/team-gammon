import { Position, diceList } from '../../../engine/index.js';
import { h, mount, classes } from '../dom.js';
import { buildScene } from '../scene.js';
import { checkerIcon, dieElement, renderBoard } from '../render.js';
import { TEAM_NAMES } from '../seats.js';
import { ClockModel } from '../clocks.js';
import { TurnBuilder, withTargets } from '../turn.js';
import { describeTurn, formatClock, resultReason, resultText, seatTitle, signed } from '../format.js';
import { deriveView, seatStats, teamStats } from '../viewmodel.js';

const LOG_SIZE = 10;

// The running game: board, dice, clocks, seats, move log, suggestions.
export function createRoomGame({ net, rules, toast, chatEl, leave, prefs, savePrefs }) {
  const clock = new ClockModel();
  let state = null;
  let view = null;
  let position = null;
  let builder = null;
  let builderKey = null;
  let selected = null;
  let sending = false;
  let resignArmed = false;
  let resignTimer = null;
  let dismissedGame = null;
  let log = [];
  let logGame = null;
  let logKey = null;

  const bannerEl = h('div', { class: 'banner', role: 'status', id: 'banner' });
  const boardEl = h('div', { class: 'board-wrap' });
  const overlayEl = h('div', { class: 'overlay', hidden: true });
  const diceEl = h('div', { class: 'dice-row' });
  const actionsEl = h('div', { class: 'actions' });
  const clocksEl = h('section', { class: 'card clocks' });
  const teamsEl = h('section', { class: 'card teams' });
  const logEl = h('section', { class: 'card log' });

  const clockTimes = [h('span', { class: 'time' }), h('span', { class: 'time' })];
  const clockRows = [0, 1].map((t) => h('div', { class: 'clock', 'data-team': t }, h('span', { class: 'label' }, `${TEAM_NAMES[t]} team`), clockTimes[t]));
  mount(clocksEl, h('h3', null, 'Team clocks'), clockRows, h('p', { class: 'hint' }, 'A clock only runs while a person is on turn.'));

  const play = h('div', { class: 'play' }, bannerEl, h('div', { class: 'board-area' }, boardEl, overlayEl), h('div', { class: 'under-board' }, diceEl, actionsEl));
  const side = h('div', { class: 'side' }, clocksEl, teamsEl, logEl, chatEl);
  const el = h('div', { class: 'room-game' }, play, side);

  function tick() {
    if (!state?.game) return;
    for (const t of [0, 1]) {
      const ms = clock.remaining(t);
      clockTimes[t].textContent = formatClock(ms);
      const running = view.live && clock.running === t;
      clockRows[t].classList.toggle('running', running);
      clockRows[t].classList.toggle('low', running && ms < 30000);
      clockRows[t].classList.toggle('mine', view.myTeam === t);
    }
  }
  const timer = setInterval(tick, 250);

  const act = async (event, payload) => {
    try {
      await net.request(event, payload);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  // --- turn input ----------------------------------------------------------------

  function afterChange() {
    if (builder.done) {
      if (view.myTurn && !prefs.confirmTurns) sendTurn();
      else if (view.canSuggest) sendSuggestion();
    }
    renderPlay();
  }

  function onPoint(p) {
    if (!builder || sending) return;
    if (selected !== null && p !== selected) {
      const step = builder.stepFor(selected, p);
      if (step) {
        builder.play(step);
        selected = null;
        afterChange();
        return;
      }
    }
    selected = p !== selected && builder.movablePoints().includes(p) ? p : null;
    renderPlay();
  }

  function onOff() {
    if (!builder || sending || selected === null) return;
    const step = builder.stepFor(selected, 0);
    if (!step) return;
    builder.play(step);
    selected = null;
    afterChange();
  }

  async function sendTurn() {
    if (sending) return;
    sending = true;
    renderPlay();
    try {
      await net.request('turn:play', { steps: builder.wire() });
    } catch (err) {
      toast(err.message, 'error');
      builder.reset();
      selected = null;
      sending = false;
      renderPlay();
    }
  }

  async function sendSuggestion() {
    const steps = builder.wire();
    try {
      await net.request('suggest:set', { steps });
      toast('Suggestion sent to your teammate.');
    } catch (err) {
      toast(err.message, 'error');
    }
    builder?.reset();
    selected = null;
    renderPlay();
  }

  function undo() {
    if (!builder || sending) return;
    builder.undo();
    selected = null;
    renderPlay();
  }

  function applySuggestion(suggestion) {
    if (!builder || sending) return;
    selected = null;
    if (!builder.replay(suggestion.steps)) {
      builder.reset();
      toast('That suggestion cannot be played any more.', 'error');
      renderPlay();
      return;
    }
    afterChange();
  }

  function resign() {
    if (!resignArmed) {
      resignArmed = true;
      clearTimeout(resignTimer);
      resignTimer = setTimeout(() => {
        resignArmed = false;
        renderActions();
      }, 4000);
      renderActions();
      return;
    }
    resignArmed = false;
    clearTimeout(resignTimer);
    act('game:resign', {});
  }

  // --- rendering -----------------------------------------------------------------

  const mySuggestions = () => (view.suggestions ?? []).filter((s) => s.turnNumber === state.game.turnNumber);

  function bannerText() {
    const g = state.game;
    if (view.over) {
      const r = g.result;
      if (view.myTeam === null || r.winnerTeam === -1) return `${resultText(r)}.`;
      return `${r.winnerTeam === view.myTeam ? 'Your team won.' : 'Your team lost.'} ${resultReason(r)}`;
    }
    if (!g.dice) return 'Rolling the dice...';
    if (view.myTurn) {
      if (sending) return 'Sending your move...';
      const note = view.transferred ? `${seatTitle(g.slotSeat)} has finished, so you play this roll. ` : '';
      if (!builder || builder.empty) return `${note}Your turn. Click one of your checkers to move it.`;
      if (builder.done) return prefs.confirmTurns ? 'Press Confirm to play this turn.' : 'Sending your move...';
      return `${note}Play your other die.`;
    }
    if (view.canSuggest) return `${view.actorName} is on turn. Click checkers to suggest a move for ${seatTitle(g.actor)}.`;
    const bot = state.seats[g.actor]?.kind === 'bot';
    const who = `${view.actorName} (${seatTitle(g.actor)})`;
    const extra = view.transferred ? ` and plays ${seatTitle(g.slotSeat)}'s roll` : '';
    return bot ? `${who}${extra} is thinking...` : `${who}${extra} is on turn.`;
  }

  function renderBanner() {
    bannerEl.textContent = bannerText();
    bannerEl.className = `banner${view.myTurn ? ' mine' : ''}${view.over ? ' over' : ''}`;
  }

  function renderDice() {
    const g = state.game;
    if (!view.live || !g.dice) {
      mount(diceEl);
      return;
    }
    const list = diceList(g.dice);
    const left = builder ? builder.remaining.slice() : list.slice();
    const faces = list.map((d) => {
      const i = left.indexOf(d);
      if (i >= 0) left.splice(i, 1);
      return dieElement(d, i < 0);
    });
    const notes = [];
    if (g.target < list.length) notes.push(`only ${g.target} of the dice can be played`);
    if (g.forcedDie) notes.push(`only the ${g.forcedDie} can be played`);
    mount(diceEl,
      h('div', { class: 'dice' }, faces),
      h('div', { class: 'muted small' }, `${seatTitle(g.slotSeat)}'s roll`, notes.length ? ` \u2013 ${notes.join(', ')}` : ''));
  }

  function sceneUi() {
    const g = state.game;
    const idle = !builder || builder.empty;
    const ui = {};
    if (builder) {
      ui.actor = builder.seat;
      ui.movable = sending ? [] : builder.movablePoints();
      ui.selected = selected ?? undefined;
      ui.targets = selected !== null ? builder.targetsFrom(selected) : [];
    }
    const suggestions = idle && view.live && g.dice
      ? mySuggestions().map((s) => ({ seat: s.seat, steps: withTargets(position, rules.seatIndex.get(g.actor), s.steps) }))
      : [];
    if (suggestions.length > 0) ui.suggestions = suggestions;
    else if (idle && g.last) ui.last = { steps: g.last.steps, team: rules.teamOf[rules.seatIndex.get(g.last.actor)] };
    return ui;
  }

  function renderBoardArea() {
    const interactive = !!builder && !sending;
    const scene = buildScene({ rules, position: builder ? builder.position : position, viewTeam: view.viewTeam, ui: sceneUi() });
    mount(boardEl, renderBoard(scene, interactive ? { onPoint, onOff, onBackground: () => { selected = null; renderPlay(); } } : {}, 'Game board'));
  }

  function renderActions() {
    const items = [];
    if (builder && !builder.empty && !sending) items.push(h('button', { type: 'button', class: 'btn', id: 'undo', onClick: undo }, 'Undo'));
    if (view.myTurn && builder?.done && prefs.confirmTurns && !sending) items.push(h('button', { type: 'button', class: 'btn primary', id: 'confirm', onClick: sendTurn }, 'Confirm turn'));
    if (view.live) {
      if (view.myTurn) {
        for (const s of mySuggestions()) {
          items.push(h('button', { type: 'button', class: 'btn', 'data-suggestion': s.seat, onClick: () => applySuggestion(s) }, `Use ${state.seats[s.seat]?.name ?? s.seat}'s suggestion`));
        }
      }
      if (view.canSuggest && mySuggestions().length > 0) items.push(h('button', { type: 'button', class: 'btn', onClick: () => act('suggest:clear', {}) }, 'Clear my suggestion'));
      if (view.mySeat) items.push(h('button', { type: 'button', class: 'btn danger', id: 'resign', onClick: resign }, resignArmed ? 'Really resign?' : 'Resign'));
      else items.push(h('button', { type: 'button', class: 'btn', id: 'leave-table', onClick: leave }, 'Leave table'));
    } else if (view.over) {
      if (view.mySeat) items.push(h('button', { type: 'button', class: 'btn primary', id: 'rematch', onClick: () => act('game:rematch', {}) }, 'Rematch'));
      items.push(h('button', { type: 'button', class: 'btn', id: 'leave-table', onClick: leave }, 'Leave table'));
    }
    items.push(h('label', { class: 'check' },
      h('input', { type: 'checkbox', id: 'confirm-turns', checked: prefs.confirmTurns, onChange: (e) => { prefs.confirmTurns = e.target.checked; savePrefs(); renderPlay(); } }),
      'Confirm each turn'));
    mount(actionsEl, items);
  }

  // What the game did to my rating; games that were too short to count say so.
  function ratingLine(r) {
    const change = view.mySeat ? r.ratings?.[view.mySeat] : null;
    if (change) {
      return h('p', { class: 'rating-change', id: 'rating-change' }, `Rating ${change.before} \u2192 ${change.after} `,
        h('strong', { class: change.after >= change.before ? 'up' : 'down' }, `(${signed(change.after - change.before)})`));
    }
    const registered = typeof state.seats[view.mySeat]?.rating === 'number';
    return registered && ['timeout', 'resign', 'deadlock'].includes(r.reason) ? h('p', { class: 'hint', id: 'rating-change' }, 'Not rated: the game was too short.') : null;
  }

  function renderOverlay() {
    const g = state.game;
    if (!view.over || dismissedGame === String(g.gameId)) {
      overlayEl.hidden = true;
      return;
    }
    const r = g.result;
    let title;
    if (r.winnerTeam === -1) title = 'Draw';
    else if (view.myTeam === null) title = `${TEAM_NAMES[r.winnerTeam]} team wins`;
    else title = r.winnerTeam === view.myTeam ? 'Your team wins!' : 'Your team loses';
    overlayEl.hidden = false;
    mount(overlayEl, h('div', { class: 'overlay-card', role: 'dialog', 'aria-label': 'Game over' },
      h('h2', null, title),
      h('p', null, resultReason(r)),
      ratingLine(r),
      h('div', { class: 'row center' },
        view.mySeat ? h('button', { type: 'button', class: 'btn primary', id: 'overlay-rematch', onClick: () => act('game:rematch', {}) }, 'Rematch') : null,
        h('button', { type: 'button', class: 'btn', onClick: () => { dismissedGame = String(g.gameId); renderOverlay(); } }, 'Show board'),
        h('button', { type: 'button', class: 'btn', onClick: leave }, 'Leave table'))));
  }

  function seatRow(id, stats) {
    const g = state.game;
    const seat = state.seats[id];
    const stat = stats[rules.seatIndex.get(id)];
    const done = stat.off === stat.total;
    const tags = [];
    if (view.mySeat === id) tags.push(h('span', { class: 'flag ok' }, 'you'));
    if (seat?.kind === 'bot') tags.push(h('span', { class: 'flag' }, 'bot'));
    if (seat?.kind === 'human' && typeof seat.rating === 'number') tags.push(h('span', { class: 'flag rating', title: 'Rating' }, seat.rating));
    if (seat?.kind === 'human' && !seat.connected) tags.push(h('span', { class: 'flag off' }, 'offline'));
    if (done) tags.push(h('span', { class: 'flag ok' }, 'home'));
    return h('div', { class: classes('seat-row', view.live && g.actor === id && 'on-turn'), 'data-seat': id },
      checkerIcon(id, 30),
      h('div', { class: 'grow' },
        h('div', { class: 'seat-name' }, seat?.name ?? id, ' ', tags),
        h('div', { class: 'muted small' }, `${stat.pips} pips left \u00b7 ${stat.off}/${stat.total} off`),
        h('div', { class: 'meter' }, h('span', { style: `width:${(100 * stat.off) / stat.total}%` }))));
  }

  function renderSide() {
    const stats = seatStats(position, rules);
    const totals = teamStats(position, rules);
    const order = view.viewTeam === 0 ? [1, 0] : [0, 1];
    mount(teamsEl, order.map((t) => h('div', { class: classes('team-block', view.myTeam === t && 'mine') },
      h('div', { class: 'team-head' },
        h('h3', null, `${TEAM_NAMES[t]} team${view.myTeam === t ? ' (your team)' : ''}`),
        h('span', { class: 'muted small' }, `${totals[t].pips} pips \u00b7 ${totals[t].off}/${totals[t].total} off`)),
      rules.teamSeats[t].map((s) => seatRow(rules.seatIds[s], stats)))));
    mount(logEl, h('h3', null, 'Moves'), log.length === 0 ? h('p', { class: 'hint' }, 'No moves yet.') : h('ol', { class: 'log-list' }, log.slice(-LOG_SIZE).reverse().map((line) => h('li', null, line))));
  }

  function renderPlay() {
    renderBanner();
    renderDice();
    renderBoardArea();
    renderActions();
  }

  function syncBuilder() {
    const g = state.game;
    const key = `${g.gameId}:${g.turnNumber}:${g.actor}`;
    const wanted = view.live && g.dice && (view.myTurn || view.canSuggest);
    if (!wanted) {
      builder = null;
      builderKey = null;
      selected = null;
      sending = false;
    } else if (key !== builderKey) {
      builder = new TurnBuilder(position, view.actorIndex, g.dice);
      builderKey = key;
      selected = null;
      sending = false;
    }
  }

  function syncLog() {
    const g = state.game;
    if (logGame !== g.gameId) {
      logGame = g.gameId;
      logKey = null;
      log = [];
    }
    const key = `${g.turnNumber}|${JSON.stringify(g.last)}`;
    if (key !== logKey) {
      logKey = key;
      if (g.last) log.push(describeTurn(g.last));
    }
  }

  return {
    el,
    update(next) {
      state = next;
      view = deriveView(next, rules);
      position = Position.fromText(rules, next.game.position);
      clock.update(next.game.clocks, next.serverTime);
      syncLog();
      syncBuilder();
      renderPlay();
      renderOverlay();
      renderSide();
      tick();
    },
    debug: () => ({ builder, selected, sending, prefs }),
    destroy() {
      clearInterval(timer);
      clearTimeout(resignTimer);
    },
  };
}
