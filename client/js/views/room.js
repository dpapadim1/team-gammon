import { h, mount } from '../dom.js';
import { createChat } from './chat.js';
import { createRoomLobby } from './roomLobby.js';
import { createRoomGame } from './roomGame.js';

const PREFS_KEY = 'tg.prefs';

function loadPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { confirmTurns: stored.confirmTurns === true };
  } catch {
    return { confirmTurns: false };
  }
}

// One table: shows the seating screen before the game and the board once it runs; the chat is shared by both.
export function createRoomView({ net, rules, hello, toast, leave }) {
  const prefs = loadPrefs();
  const savePrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // storage can be blocked; the setting then only lasts for this visit
    }
  };
  const chat = createChat({ net, toast });
  const el = h('div', { class: 'room' });
  let current = null;
  let mode = null;

  function ensure(next) {
    if (mode === next) return;
    current?.destroy();
    mode = next;
    const ctx = { net, rules, hello, toast, leave, chatEl: chat.el, prefs, savePrefs };
    current = next === 'lobby' ? createRoomLobby(ctx) : createRoomGame(ctx);
    mount(el, current.el);
  }

  return {
    el,
    update(state) {
      ensure(state.phase === 'lobby' ? 'lobby' : 'game');
      chat.setContext({ seated: !!state.you?.seat });
      current.update(state);
    },
    setMessages: (messages) => chat.setMessages(messages),
    addMessage: (message) => chat.add(message),
    debug: () => current?.debug?.() ?? null,
    destroy() {
      current?.destroy();
    },
  };
}
