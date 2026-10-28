import { h, mount } from '../dom.js';

// Sign in, create an account, or play as a guest.
export function createAuthView({ api, onSignedIn }) {
  let mode = 'login';
  let busy = false;
  const el = h('section', { class: 'card auth' });

  async function run(task, errorBox, buttons) {
    if (busy) return;
    busy = true;
    errorBox.textContent = '';
    for (const b of buttons) b.disabled = true;
    try {
      onSignedIn(await task());
    } catch (err) {
      errorBox.textContent = err.message;
      busy = false;
      for (const b of buttons) b.disabled = false;
    }
  }

  function render() {
    const login = mode === 'login';
    const error = h('p', { class: 'error', role: 'alert' });
    const username = h('input', { id: 'auth-username', name: 'username', type: 'text', autocomplete: 'username', required: true, minlength: 3, maxlength: 20, autocapitalize: 'none', spellcheck: 'false' });
    const password = h('input', { id: 'auth-password', name: 'password', type: 'password', autocomplete: login ? 'current-password' : 'new-password', required: true, minlength: login ? 1 : 8, maxlength: 128 });
    const submit = h('button', { type: 'submit', class: 'btn primary' }, login ? 'Sign in' : 'Create account');
    const guest = h('button', { type: 'button', class: 'btn', id: 'auth-guest' }, 'Play as guest');
    const buttons = [submit, guest];
    mount(el,
      h('h1', null, 'Team Gammon'),
      h('p', { class: 'lead' }, 'Four players, two teams, one board. Race your checkers home with a partner at your side.'),
      h('div', { class: 'tabs', role: 'tablist' },
        h('button', { type: 'button', role: 'tab', class: login ? 'active' : '', 'aria-selected': login, onClick: () => { mode = 'login'; render(); } }, 'Sign in'),
        h('button', { type: 'button', role: 'tab', class: login ? '' : 'active', 'aria-selected': !login, onClick: () => { mode = 'register'; render(); } }, 'New account')),
      h('form', { onSubmit: (e) => { e.preventDefault(); run(() => (login ? api.login : api.register)(username.value.trim(), password.value), error, buttons); } },
        h('label', { for: 'auth-username' }, 'Name'),
        username,
        h('label', { for: 'auth-password' }, 'Password'),
        password,
        login ? null : h('p', { class: 'hint' }, '3-20 letters, digits or underscores. The password needs at least 8 characters.'),
        error,
        h('div', { class: 'row' }, submit)),
      h('div', { class: 'divider' }, h('span', null, 'or')),
      guest,
      h('p', { class: 'hint' }, 'Guests can play right away. Accounts keep their game history.'),
      h('p', { class: 'hint' }, 'New to the game? ', h('a', { href: '/tutorial', target: '_blank', rel: 'noopener' }, 'Take the five-lesson tutorial'), '.'),
      h('p', { class: 'hint legal-hint' }, 'By continuing you accept the ',
        h('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'terms'), ' and the ',
        h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'privacy policy'), '.'));
    guest.addEventListener('click', () => run(() => api.guest(), error, buttons));
    username.focus();
  }

  render();
  return { el };
}
