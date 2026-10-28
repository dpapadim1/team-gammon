import { h, mount } from '../dom.js';
import { seatStyle } from '../seats.js';
import { seatTitle } from '../format.js';

const MAX_MESSAGES = 200;

// Chat for the current table. All text is inserted as text nodes.
export function createChat({ net, toast }) {
  let messages = [];
  let canTeam = false;

  const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': 'Chat messages' });
  const input = h('input', { type: 'text', maxlength: 300, placeholder: 'Say something', autocomplete: 'off', 'aria-label': 'Chat message' });
  const channel = h('select', { 'aria-label': 'Send to', class: 'chat-channel' },
    h('option', { value: 'all' }, 'Everyone'),
    h('option', { value: 'team' }, 'My team'));
  const form = h('form', { class: 'chat-form', onSubmit: submit }, channel, input, h('button', { type: 'submit', class: 'btn' }, 'Send'));
  const el = h('section', { class: 'card chat' }, h('h3', null, 'Chat'), log, form);

  async function submit(event) {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    try {
      await net.request('chat:send', { text, channel: canTeam ? channel.value : 'all' });
      input.value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function line(m) {
    const team = m.channel === 'team';
    const color = m.from.seat ? seatStyle(m.from.seat).mid : null;
    return h('div', { class: `msg${team ? ' team' : ''}`, title: new Date(m.ts).toLocaleTimeString() },
      team ? h('span', { class: 'tag' }, 'team') : null,
      h('span', { class: 'who', style: color ? `color:${color}` : null, title: m.from.seat ? seatTitle(m.from.seat) : 'Spectator' }, m.from.name),
      ' ',
      h('span', { class: 'said' }, m.text));
  }

  function render() {
    const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    mount(log, messages.map(line));
    if (stick) log.scrollTop = log.scrollHeight;
  }

  return {
    el,
    setMessages(list) {
      messages = list.slice(-MAX_MESSAGES);
      render();
      log.scrollTop = log.scrollHeight;
    },
    add(message) {
      messages.push(message);
      if (messages.length > MAX_MESSAGES) messages.shift();
      render();
    },
    setContext({ seated }) {
      canTeam = seated;
      channel.hidden = !seated;
      if (!seated) channel.value = 'all';
    },
    clear() {
      messages = [];
      render();
    },
  };
}
