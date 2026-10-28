// End-to-end check of the web client in a real browser (Microsoft Edge through playwright-core).
// Run with `npm run e2e`, or `npm run e2e -- puzzlePage tutorial` for just those scenarios. Screenshots go to e2e/out/ so the screens can be looked at.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startTestServer } from '../testkit/server.js';

const OUT = fileURLToPath(new URL('./out/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const problems = [];
const log = (msg) => console.log(`- ${msg}`);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

function watch(page, label) {
  page.on('pageerror', (err) => problems.push(`${label}: page error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/status of 401/.test(text)) return;
    problems.push(`${label}: console error: ${text}`);
  });
}

async function newPlayer(browser, base, label, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watch(page, label);
  await page.goto(`${base}/`);
  return { context, page, label };
}

async function guestLogin(page) {
  await page.click('#auth-guest');
  await page.waitForSelector('#quick-play');
}

async function submitCredentials(page, username, password) {
  await page.fill('#auth-username', username);
  await page.fill('#auth-password', password);
  await page.click('form button[type="submit"]');
}

const stateOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__tg.state)));

// A random legal turn for the seat on turn, as a list of [from, to] clicks.
function chooseMoves(page) {
  return page.evaluate(async () => {
    const { TurnBuilder } = await import('/client/js/turn.js');
    const { Position } = await import('/engine/index.js');
    const st = window.__tg.state;
    const rules = window.__tg.rules;
    const builder = new TurnBuilder(Position.fromText(rules, st.game.position), rules.seatIndex.get(st.game.actor), st.game.dice);
    const moves = [];
    while (!builder.done) {
      const legal = builder.legal();
      if (legal.length === 0) break;
      const from = legal[Math.floor(Math.random() * legal.length)].from;
      const options = builder.targetsFrom(from);
      const to = options[Math.floor(Math.random() * options.length)].to;
      builder.play(builder.stepFor(from, to));
      moves.push([from, to]);
    }
    return moves;
  });
}

async function clickMove(page, [from, to]) {
  await page.locator(`rect.hit[data-point="${from}"]`).click();
  await page.locator(to === 0 ? 'rect.hit[data-off]' : `rect.hit[data-point="${to}"]`).click();
}

const myTurnReady = () => {
  const s = window.__tg.state;
  const g = s?.game;
  return !!g && (!!g.result || (!!g.dice && g.actor === s.you.seat && !!window.__tg.room?.debug()?.builder));
};

// Plays this player's turns with real clicks until the game ends or `turns` turns were played.
async function playTurns(page, { turns = Infinity } = {}) {
  let played = 0;
  while (played < turns) {
    await page.waitForFunction(myTurnReady, null, { timeout: 90000 });
    const st = await stateOf(page);
    if (st.game.result) break;
    for (const move of await chooseMoves(page)) await clickMove(page, move);
    played++;
    await page.waitForFunction((n) => { const g = window.__tg.state.game; return !!g.result || g.turnNumber !== n; }, st.game.turnNumber, { timeout: 20000 });
  }
  return { over: !!(await stateOf(page)).game.result, played };
}

async function soloGame(browser, base) {
  log('solo game against bots');
  const { page, context } = await newPlayer(browser, base, 'solo');
  await page.waitForSelector('#auth-guest');
  await shot(page, '01-auth');
  await page.click('button[role="tab"]:has-text("New account")');
  await submitCredentials(page, 'e2e_player', 'correct horse battery');
  await page.waitForSelector('#quick-play');
  await page.waitForSelector('text=No public tables yet');
  await shot(page, '02-lobby');
  await page.click('#quick-play');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing', null, { timeout: 15000 });
  await page.waitForSelector('svg.board rect.hit');
  await shot(page, '03-game-start');
  const first = await playTurns(page, { turns: 6 });
  assert.equal(first.over, false);
  assert.equal(await page.locator('.toast.error').count(), 0, 'no error toasts while playing');
  await shot(page, '04-game-mid');

  // Selecting a checker shows where it can go.
  await page.waitForFunction(myTurnReady, null, { timeout: 60000 });
  const movable = await page.locator('svg.board rect.hit.active').first();
  await movable.click();
  assert.ok(await page.locator('svg.board .ghost').count() > 0, 'targets are shown after selecting a checker');
  await shot(page, '05-selected');
  await page.locator('svg.board').click({ position: { x: 5, y: 5 } });

  // With "Confirm each turn" a finished turn waits for a click, and Undo takes it back.
  await page.check('#confirm-turns');
  const before = (await stateOf(page)).game.turnNumber;
  for (const move of await chooseMoves(page)) await clickMove(page, move);
  await page.waitForSelector('#confirm');
  assert.equal((await stateOf(page)).game.turnNumber, before, 'nothing is sent before confirming');
  await shot(page, '05b-confirm');
  await page.click('#undo');
  assert.equal(await page.locator('#confirm').count(), 0, 'undo takes a move back');
  while (await page.locator('#undo').count() > 0) await page.click('#undo');
  for (const move of await chooseMoves(page)) await clickMove(page, move);
  await page.click('#confirm');
  await page.waitForFunction((n) => window.__tg.state.game.turnNumber !== n, before, { timeout: 20000 });
  await page.uncheck('#confirm-turns');

  const rest = await playTurns(page);
  assert.equal(rest.over, true, 'the game reaches an end');
  await page.waitForSelector('.overlay-card');
  const heading = await page.locator('.overlay-card h2').textContent();
  assert.match(heading, /wins|loses|Draw/);
  assert.equal(await page.locator('.toast.error').count(), 0, 'no error toasts during the whole game');
  // The game moved the rating of the new account, on the card and in the header.
  const change = await page.locator('#rating-change').textContent();
  assert.match(change, /^Rating 1200 \u2192 \d+ \([+\u2212]\d+\)$/);
  const newRating = Number(change.match(/\u2192 (\d+)/)[1]);
  assert.notEqual(newRating, 1200);
  assert.equal(Number(await page.locator('#my-rating').textContent()), newRating, 'the header shows the new rating');
  await shot(page, '06-game-over');
  log(`game over: ${heading}`);

  await page.click('#overlay-rematch');
  await page.waitForSelector('#ready-btn');
  await shot(page, '07-rematch-lobby');
  await page.click('#leave-table');
  await page.waitForSelector('#quick-play');
  assert.equal(await page.evaluate(() => window.__tg.state), null);

  // The finished game is in the history of the registered player.
  await page.waitForSelector('.table-row .result');
  assert.match(await page.locator('.table-row .result').first().textContent(), /Won|Lost/);
  assert.match(await page.locator('.table-row .rating-delta').first().textContent(), /^[+\u2212]\d+$/, 'the history shows the rating change');
  await shot(page, '07b-history');

  // The public leaderboard lists the player, marked as provisional.
  const board = await context.newPage();
  watch(board, 'leaderboard');
  await board.goto(`${base}/leaderboard`);
  await board.waitForSelector('#rows tr.mine');
  assert.match(await board.locator('#rows tr.mine').textContent(), new RegExp(`e2e_player \\(you\\)${newRating}`));
  assert.equal(await board.locator('#rows tr.mine.provisional').count(), 1);
  await board.screenshot({ path: path.join(OUT, '23-leaderboard.png'), fullPage: true });
  await board.close();

  // Signing out and in again; a wrong password is refused with a clear message.
  await page.click('#sign-out');
  await page.waitForSelector('#auth-guest');
  await submitCredentials(page, 'e2e_player', 'not the password');
  await page.waitForSelector('.error:has-text("Wrong username or password")');
  await submitCredentials(page, 'e2e_player', 'correct horse battery');
  await page.waitForSelector('#quick-play');
  await context.close();
}

async function strongestBots(browser, base) {
  log('quick game against level 9 bots');
  const { page, context } = await newPlayer(browser, base, 'strong');
  await page.waitForSelector('#auth-guest');
  await guestLogin(page);
  await page.selectOption('#quick-level', '9');
  await page.click('#quick-play');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing', null, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => Object.values(window.__tg.state.seats).filter((s) => s.kind === 'bot').map((s) => s.level)), [9, 9, 9]);
  const turn = (await stateOf(page)).game.turnNumber;
  const result = await playTurns(page, { turns: 5 });
  assert.equal(result.over, false);
  assert.ok((await stateOf(page)).game.turnNumber >= turn + 15, 'the bots answer every turn');
  assert.equal(await page.locator('.toast.error').count(), 0);
  await shot(page, '09b-level9-game');
  await context.close();
}

async function rulesPage(browser, base) {
  log('rules page');
  const { page, context } = await newPlayer(browser, base, 'rules');
  await page.goto(`${base}/rules`);
  await page.waitForSelector('#demo-start svg.board');
  await page.waitForSelector('#demo-pin svg.board');
  assert.equal(await page.locator('#demo-pin .pin-ring').count(), 1, 'one pinned checker is drawn');
  assert.equal(await page.locator('#demo-start .checker').count(), 32);
  await page.screenshot({ path: path.join(OUT, '20-rules.png'), fullPage: true });
  await context.close();
}

async function tutorial(browser, base) {
  log('tutorial');
  const { page, context } = await newPlayer(browser, base, 'tutorial');
  await page.goto(`${base}/tutorial`);
  const play = async (moves) => {
    for (const move of moves) await clickMove(page, move);
  };
  const next = async () => {
    await page.waitForSelector('#feedback.ok');
    await page.click('#next');
  };

  await page.waitForSelector('svg.board rect.hit.active');
  assert.match(await page.locator('#progress').textContent(), /Lesson 1 of 5/);
  await play([[24, 18], [24, 21]]);
  await next();

  // A legal turn that misses the point gets a hint and can be repeated.
  await play([[24, 20], [24, 22]]);
  await page.waitForSelector('#feedback.hint');
  await page.click('#retry');
  await page.locator('rect.hit[data-point="14"]').click();
  await shot(page, '24a-tutorial-blocks');
  await page.locator('rect.hit[data-point="12"]').click();
  await clickMove(page, [12, 8]);
  await next();

  await play([[17, 14], [24, 23]]);
  assert.equal(await page.locator('svg.board .pin-ring').count(), 1, 'the lone checker is pinned');
  await page.waitForSelector('#feedback.ok');
  await shot(page, '24b-tutorial-pin');
  await next();

  await play([[6, 0], [2, 0]]);
  await next();

  await page.waitForSelector('#finish:not([hidden])');
  assert.equal(await page.locator('svg.board').count(), 0, 'the last lesson has no board');
  await page.screenshot({ path: path.join(OUT, '24-tutorial.png'), fullPage: true });
  await context.close();
}

async function puzzlePage(browser, base) {
  log('puzzles');
  const { puzzles } = JSON.parse(readFileSync(new URL('../client/puzzles.json', import.meta.url), 'utf8'));
  const { page, context } = await newPlayer(browser, base, 'puzzles');
  const solvedText = (n) => `${n} of ${puzzles.length} solved`;
  // The clicks, as [from, to] pairs, that play one of a puzzle's plays.
  const clicksFor = (puzzle, index) => page.evaluate(async ([p, i]) => {
    const { describePlay } = await import('/client/js/puzzles.js');
    const { Position, OFF } = await import('/engine/index.js');
    const { rulesFor } = await import('/client/js/format.js');
    const rules = rulesFor();
    return describePlay(Position.fromText(rules, p.position), rules.seatIndex.get(p.seat), p.plays[i].steps).steps.map((s) => [s.from, s.to === OFF ? 0 : s.to]);
  }, [puzzle, index]);
  const playOut = async (puzzle, index) => {
    for (const move of await clicksFor(puzzle, index)) await clickMove(page, move);
  };
  // The puzzle the page is showing, known by the number in the address. Bearing off with either of two dice can end in
  // different positions when clicked, so puzzles about it cannot be played out here.
  const shown = async () => {
    await page.waitForSelector('svg.board rect.hit.active');
    const puzzle = puzzles.find((p) => `#${p.id}` === new URL(page.url()).hash);
    assert.ok(!puzzle.themes.includes('bearoff'), `puzzle ${puzzle.id} is about bearing off: play it out by hand`);
    return puzzle;
  };
  // Back to the list. It is drawn at the moment it becomes visible, so its texts are current from then on.
  const toList = async () => {
    await page.click('#all');
    await page.waitForSelector('#list-view:not([hidden])');
  };
  const text = async (selector) => (await page.locator(selector).first().textContent()).trim();

  await page.goto(`${base}/puzzles`);
  await page.waitForSelector('#start');
  assert.equal(await text('#rating'), '1000');
  assert.match(await text('#provisional'), /provisional/);
  assert.equal(await text('#start'), 'Start');
  assert.equal(await page.locator('.puzzle-card').count(), 0, 'no puzzle is shown before it has been served');
  assert.equal(await page.locator('#history').isVisible(), false);
  assert.equal(await text('#waiting'), `${puzzles.length} more puzzles are waiting for you.`);
  assert.equal(await text('#progress'), solvedText(0));
  await page.screenshot({ path: path.join(OUT, '25-puzzle-list.png'), fullPage: true });

  // A puzzle that has not been served cannot be opened by its address.
  await page.goto(`${base}/puzzles#${puzzles.at(-1).id}`);
  await page.waitForSelector('#list-view:not([hidden])');
  await page.waitForFunction(() => location.hash === '', null, { timeout: 5000 });

  // The first puzzle: Next waits for an attempt. A hint and then the weakest play is a miss and lowers the rating.
  await page.click('#start');
  const first = await shown();
  assert.match(await text('#prompt'), /find the best play/);
  assert.equal(await text('#meta'), 'Your puzzle rating 1000');
  assert.equal(await page.locator('#next').isDisabled(), true, 'the next puzzle waits for an attempt');
  assert.equal(await page.locator('#note').isVisible(), true, 'the rules of the rating are explained');
  assert.equal(await page.locator('#verdict').count(), 0, 'no verdict before a play');
  await page.click('#hint');
  assert.notEqual(await text('#hint-text'), '');
  await shot(page, '25a-puzzle');
  await playOut(first, first.plays.length - 1);
  await page.waitForSelector('#verdict');
  assert.notEqual(await page.locator('#verdict').getAttribute('data-kind'), 'best');
  assert.match(await text('#verdict'), /the best play won \d+\.\d%/);
  const miss = await text('#rating-change');
  assert.match(miss, /^Puzzle rating 1000 \u2192 \d+ \(\u2212\d+\)\. This puzzle is rated \d+\.$/);
  const afterMiss = Number(miss.match(/\u2192 (\d+)/)[1]);
  assert.ok(afterMiss < 1000);
  assert.equal(await page.locator('#next').isDisabled(), false, 'once the miss counts, the next puzzle can come');
  assert.equal(await page.locator('#note').isVisible(), false);
  await shot(page, '25b-puzzle-wrong');

  // Trying again and finding the best play solves the puzzle but does not rate it a second time.
  await page.click('#retry');
  await page.waitForSelector('svg.board rect.hit.active');
  await playOut(first, 0);
  await page.waitForSelector('#verdict[data-kind="best"]');
  assert.match(await text('#verdict h2'), /Best play/);
  assert.match(await text('#verdict'), /won \d+\.\d% of \d+ games/);
  assert.equal(await page.locator('#rating-change').count(), 0, 'only the first attempt is rated');
  assert.match(await text('#meta'), new RegExp(`^Your puzzle rating ${afterMiss} \\u00b7 this puzzle \\d+ (easy|medium|hard)`));
  await shot(page, '25c-puzzle-solved');

  // Next serves another puzzle. Showing its best play counts as a miss, and finding it afterwards does not count as solved.
  await page.click('#next');
  await page.waitForFunction((id) => location.hash !== `#${id}`, first.id);
  const second = await shown();
  await page.click('#show');
  await page.waitForSelector('svg.board .arrow');
  assert.match(await text('#result'), /The best play/);
  assert.match(await text('#rating-change'), /^Showing the best play counts as a miss\. Puzzle rating \d+ \u2192 \d+ \(\u2212\d+\)/);
  assert.equal(await page.locator('svg.board rect.hit.active').count(), 0, 'the board is locked while the answer is shown');
  await shot(page, '25d-puzzle-answer');
  await page.click('#retry');
  await page.waitForSelector('svg.board rect.hit.active');
  await playOut(second, 0);
  await page.waitForSelector('#verdict[data-kind="best"]');
  assert.equal(await page.locator('#rating-change').count(), 0);

  // The list now holds the two puzzles that were served, newest first, with what each did to the rating.
  await toList();
  const rating = Number(await text('#rating'));
  assert.ok(rating < afterMiss, 'the second miss lowered it further');
  assert.equal(await page.locator('.puzzle-card').count(), 2);
  assert.equal(await page.locator('.puzzle-card.solved').count(), 1, 'a puzzle found after peeking is not solved');
  assert.equal(await page.locator('.puzzle-card').first().getAttribute('data-id'), String(second.id));
  assert.match(await text('.puzzle-card .delta'), /^\u2212\d+$/);
  assert.equal(await text('#progress'), solvedText(1));
  assert.equal(await text('#waiting'), `${puzzles.length - 2} more puzzles are waiting for you.`);
  assert.equal(await text('#start'), 'Next puzzle');
  await page.screenshot({ path: path.join(OUT, '25e-puzzle-history.png'), fullPage: true });
  await page.reload();
  await page.waitForSelector('.puzzle-card');
  assert.equal(await text('#rating'), String(rating), 'the rating is remembered in this browser');
  assert.equal(await page.locator('.puzzle-card.solved').count(), 1);

  // A puzzle seen before can be played again, and nothing moves the rating a second time.
  await page.click(`.puzzle-card[data-id="${first.id}"]`);
  await page.waitForSelector('svg.board rect.hit.active');
  assert.equal(await page.locator('#next').isDisabled(), false);
  await playOut(first, first.plays.length - 1);
  await page.waitForSelector('#verdict');
  assert.equal(await page.locator('#rating-change').count(), 0);
  await toList();
  assert.equal(await text('#rating'), String(rating));

  // Start serves a puzzle that has not been seen.
  await page.click('#start');
  const third = await shown();
  assert.ok(![first.id, second.id].includes(third.id));

  // On a phone the board and the buttons fit the screen.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const small = await phone.newPage();
  watch(small, 'puzzles on a phone');
  await small.goto(`${base}/puzzles`);
  await small.click('#start');
  await small.waitForSelector('svg.board rect.hit.active');
  const overflow = await small.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no sideways scrolling on a phone (overflow ${overflow}px)`);
  await small.screenshot({ path: path.join(OUT, '25e-puzzle-phone.png'), fullPage: true });
  await phone.close();
  await context.close();
}

async function legalAndDeletion(browser, base) {
  log('legal pages and account deletion');
  const { page, context } = await newPlayer(browser, base, 'privacy');
  await page.waitForSelector('#auth-guest');
  assert.equal(await page.locator('.auth a[href="/terms"]').count(), 1, 'sign-in links the terms');
  assert.equal(await page.locator('.auth a[href="/privacy"]').count(), 1, 'and the privacy policy');
  for (const [route, heading] of [['/privacy', 'Privacy policy'], ['/terms', 'Terms of service'], ['/cookies', 'Cookie policy']]) {
    await page.goto(`${base}${route}`);
    assert.equal(await page.locator('h1').textContent(), heading);
  }
  await page.screenshot({ path: path.join(OUT, '21-legal.png'), fullPage: true });

  // A registered player can delete the account; the name stops working afterwards.
  await page.goto(`${base}/`);
  await page.waitForSelector('#auth-guest');
  await page.click('button[role="tab"]:has-text("New account")');
  await submitCredentials(page, 'e2e_leaver', 'correct horse battery');
  await page.waitForSelector('#quick-play');
  await page.click('.account summary');
  await page.fill('#delete-password', 'not the password');
  await page.click('#delete-account');
  await page.waitForSelector('.toast.error:has-text("Wrong username or password")');
  await page.fill('#delete-password', 'correct horse battery');
  await shot(page, '22-delete-account');
  await page.click('#delete-account');
  await page.waitForSelector('#auth-guest');
  await submitCredentials(page, 'e2e_leaver', 'correct horse battery');
  await page.waitForSelector('.error:has-text("Wrong username or password")');
  await context.close();
}

async function mobileView(browser, base) {
  log('phone-sized screen');
  const { page, context } = await newPlayer(browser, base, 'mobile', { width: 390, height: 844 });
  await page.waitForSelector('#auth-guest');
  await shot(page, '08-mobile-auth');
  await guestLogin(page);
  await shot(page, '09-mobile-lobby');
  await page.click('#quick-play');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing', null, { timeout: 15000 });
  await page.waitForSelector('svg.board rect.hit');
  await page.waitForFunction(myTurnReady, null, { timeout: 30000 });
  await shot(page, '10-mobile-game');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 1, `no sideways scrolling on a phone (overflow ${overflow}px)`);
  await context.close();
}

async function teamGame(browser, base) {
  log('three people and a bot: seating, chat and suggestions');
  const a = await newPlayer(browser, base, 'A');
  await guestLogin(a.page);
  await a.page.click('#create-table');
  await a.page.waitForSelector('input.invite');
  const invite = await a.page.inputValue('input.invite');
  assert.match(invite, /#\/room\/[a-z2-9]{8}$/);

  const b = await newPlayer(browser, base, 'B');
  await guestLogin(b.page);
  await b.page.goto(invite);
  await b.page.waitForSelector('[data-claim]');
  const c = await newPlayer(browser, base, 'C');
  await guestLogin(c.page);
  await c.page.goto(invite);
  await c.page.waitForSelector('[data-claim]');

  await a.page.click('[data-claim="t1"]');
  await b.page.click('[data-claim="t2"]');
  await c.page.click('[data-claim="b1"]');
  await a.page.waitForSelector('.seat-card[data-seat="b1"] .seat-name:has-text("Guest")');
  await shot(a.page, '11-room-lobby-host');
  await a.page.click('#fill-bots');
  await a.page.waitForFunction(() => Object.values(window.__tg.state.seats).every(Boolean));
  await shot(c.page, '12-room-lobby-guest');
  assert.equal(await c.page.locator('#fill-bots').isVisible(), false, 'only the host sees the bot controls');

  // Chat: a team message stays inside the team.
  await a.page.fill('.chat-form input', 'hello team');
  await a.page.selectOption('.chat-channel', 'team');
  await a.page.click('.chat-form button');
  await b.page.waitForSelector('.msg.team:has-text("hello team")');
  await a.page.selectOption('.chat-channel', 'all');
  await a.page.fill('.chat-form input', 'good luck everyone');
  await a.page.click('.chat-form button');
  await c.page.waitForSelector('.msg:has-text("good luck everyone")');
  assert.equal(await c.page.locator('.msg:has-text("hello team")').count(), 0, 'opponents do not see team chat');

  for (const p of [a, b, c]) await p.page.click('#ready-btn');
  for (const p of [a, b, c]) await p.page.waitForFunction(() => window.__tg.state?.phase === 'playing', null, { timeout: 20000 });

  // A spectator can watch the running game but not touch it.
  const d = await newPlayer(browser, base, 'D');
  await guestLogin(d.page);
  await d.page.goto(invite);
  await d.page.waitForSelector('svg.board');
  assert.equal(await d.page.locator('svg.board rect.hit').count(), 0, 'spectators cannot touch the board');
  assert.equal(await d.page.locator('#resign').count(), 0, 'spectators cannot resign');
  await shot(d.page, '12b-spectator');

  // Everyone plays with real clicks. When t1 or t2 is first on turn, the teammate suggests and the player adopts it.
  const demonstrated = new Set();
  while (demonstrated.size < 2) {
    await a.page.waitForFunction(() => {
      const g = window.__tg.state?.game;
      return !!g && !!g.dice && !g.result && ['t1', 't2', 'b1'].includes(g.actor);
    }, null, { timeout: 90000 });
    const g = (await stateOf(a.page)).game;
    if (g.actor === 'b1') {
      await playTurns(c.page, { turns: 1 });
      continue;
    }
    const [player, mate, name] = g.actor === 't1' ? [a, b, 'A'] : [b, a, 'B'];
    if (demonstrated.has(g.actor)) {
      await playTurns(player.page, { turns: 1 });
      continue;
    }
    await mate.page.waitForFunction(() => !!window.__tg.room?.debug()?.builder, null, { timeout: 15000 });
    for (const move of await chooseMoves(mate.page)) await clickMove(mate.page, move);
    await player.page.waitForSelector('svg.board .arrow.hint');
    await shot(player.page, `13-suggestion-${name}-sees`);
    await shot(mate.page, `14-suggestion-${name}-sent`);
    await player.page.click('[data-suggestion]');
    await player.page.waitForFunction((n) => window.__tg.state.game.turnNumber !== n, g.turnNumber, { timeout: 20000 });
    demonstrated.add(g.actor);
    log(`${name} adopted a suggestion`);
  }

  // Keep playing until it is C's turn, so the Bottom team's view can be checked while it is active.
  for (;;) {
    await a.page.waitForFunction(() => {
      const g = window.__tg.state?.game;
      return !!g && !!g.dice && !g.result && ['t1', 't2', 'b1'].includes(g.actor);
    }, null, { timeout: 90000 });
    const g = (await stateOf(a.page)).game;
    if (g.actor === 'b1') break;
    await playTurns(g.actor === 't1' ? a.page : b.page, { turns: 1 });
  }
  await c.page.waitForFunction(myTurnReady, null, { timeout: 90000 });
  await shot(c.page, '15-bottom-team-view');
  assert.equal(await c.page.locator('svg.board').evaluate((svg) => svg.querySelector('.home.mine').getBoundingClientRect().top > svg.querySelector('.home.theirs').getBoundingClientRect().top), true, 'the Bottom team has its home at the bottom too');

  // A dropped connection comes back to the same table.
  await b.page.evaluate(() => window.__tg.app.net.socket.io.engine.close());
  await b.page.waitForSelector('#connection:not([hidden])', { timeout: 10000 });
  await shot(b.page, '16-offline');
  await b.page.waitForSelector('#connection', { state: 'hidden', timeout: 30000 });
  assert.equal(await b.page.evaluate(() => window.__tg.state?.room.id), invite.split('/').pop());
  assert.equal(await b.page.evaluate(() => window.__tg.state?.you.seat), 't2', 'still seated after reconnecting');

  // Resigning ends the game for everybody.
  await a.page.click('#resign');
  await a.page.click('#resign');
  for (const p of [a, b, c, d]) await p.page.waitForSelector('.overlay-card');
  const headings = await Promise.all([a, b, c, d].map((p) => p.page.locator('.overlay-card h2').textContent()));
  assert.equal(headings[0], 'Your team loses');
  assert.equal(headings[1], 'Your team loses');
  assert.equal(headings[2], 'Your team wins!');
  assert.equal(headings[3], 'Bottom team wins');
  await shot(c.page, '17-resigned');
  for (const p of [a, b, c, d]) {
    assert.equal(await p.page.locator('.toast.error').count(), 0, `${p.label}: no error toasts`);
    await p.context.close();
  }
}

const scenarios = { soloGame, strongestBots, rulesPage, tutorial, puzzlePage, legalAndDeletion, mobileView, teamGame };
const wanted = process.argv.slice(2);
for (const name of wanted) assert.ok(name in scenarios, `unknown scenario ${name}`);

const srv = await startTestServer({ timing: { startDelayMs: 300, rollDelayMs: 100, passDelayMs: 200, botThinkMs: 100 } });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
let failed = false;
try {
  for (const [name, run] of Object.entries(scenarios)) {
    if (wanted.length === 0 || wanted.includes(name)) await run(browser, srv.baseUrl);
  }
} catch (err) {
  failed = true;
  console.error(err);
} finally {
  await browser.close();
  await srv.close();
}
if (problems.length) {
  failed = true;
  console.error('Problems seen in the browser:');
  for (const p of problems) console.error(`  ${p}`);
}
console.log(failed ? 'E2E FAILED' : 'E2E passed');
process.exit(failed ? 1 : 0);
