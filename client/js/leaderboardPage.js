import { api } from './api.js';
import { h, mount } from './dom.js';

const $ = (id) => document.getElementById(id);

function row(player, mine) {
  const classes = [mine && 'mine', player.provisional && 'provisional'].filter(Boolean).join(' ');
  return h('tr', { class: classes },
    h('td', null, player.rank),
    h('td', null, player.name, mine ? ' (you)' : ''),
    h('td', { class: 'num' }, player.rating, player.provisional ? h('span', { class: 'hint', title: 'Provisional rating' }, ' ?') : null),
    h('td', { class: 'num' }, player.games),
    h('td', { class: 'num' }, player.wins));
}

async function load() {
  try {
    const { players, me } = await api.leaderboard(100);
    $('empty').hidden = players.length > 0;
    $('board').hidden = players.length === 0;
    mount($('rows'), players.map((p) => row(p, me?.name === p.name)));
    if (me && !players.some((p) => p.name === me.name)) {
      $('me').hidden = false;
      $('me').textContent = `You are ranked #${me.rank} with ${me.rating}.`;
    }
  } catch (err) {
    $('problem').textContent = err.message;
  }
}

load();
