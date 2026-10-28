// End-to-end check of the app bundle in a phone-sized headless Edge: start page, bundled pages, and a full
// offline game against level-9 bots (the value network) with the human seat played through the local table.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from './build-www.mjs';
import { serve } from './serve.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

function check(cond, message) {
  if (!cond) throw new Error(`FAILED: ${message}`);
  console.log(`ok - ${message}`);
}

build();
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
const page = await context.newPage();
page.on('pageerror', (err) => errors.push(String(err)));
page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

try {
  await page.goto(`${base}/`);
  check(await page.locator('#play-offline').isVisible(), 'start page shows offline play');
  check(await page.getAttribute('#play-online', 'href') === 'https://www.team-gammon.com/', 'online play opens the website');
  await page.screenshot({ path: path.join(OUT, '01-home.png') });

  for (const name of ['rules', 'tutorial', 'puzzles', 'privacy', 'terms', 'cookies']) {
    await page.goto(`${base}/client/${name}.html`);
    await page.waitForLoadState('networkidle');
    const bad = await page.$$eval('a[href^="/"]', (as) => as.map((a) => a.getAttribute('href')).filter((h) => !/^\/(index\.html|client\/[a-z]+\.html)$/.test(h)));
    check(bad.length === 0, `${name} page links stay inside the bundle${bad.length ? `: ${bad.join(', ')}` : ''}`);
  }
  await page.goto(`${base}/client/puzzles.html`);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: path.join(OUT, '02-puzzles.png') });

  await page.goto(`${base}/play.html`);
  await page.waitForSelector('#offline-start');
  check(await page.evaluate(() => window.__tg.champion !== null), 'value network loads in the browser');
  await page.screenshot({ path: path.join(OUT, '03-setup.png') });
  await page.selectOption('#offline-level', '9');
  // Short delays so a whole game fits in the test.
  await page.evaluate(() => {
    const s = window.__tg.net.services;
    s.config = { ...s.config, timing: { startDelayMs: 20, rollDelayMs: 20, passDelayMs: 20, botThinkMs: 20 } };
  });
  await page.click('#offline-start');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing');
  check(true, 'offline game starts');
  await page.waitForSelector('.board svg, svg', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '04-game.png') });

  const played = await page.evaluate(async () => {
    const { enumerateTurns, stepsToWire } = await import('/engine/index.js');
    const net = window.__tg.net;
    let turns = 0;
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const state = window.__tg.state;
      if (state.phase === 'over') return { turns, result: state.game.result };
      const g = net.room.session.game;
      const mine = g.phase === 'move' && g.actor === net.room.rules.seatIndex.get(state.you.seat);
      if (mine) {
        const steps = enumerateTurns(g.position, g.actor, g.dice, { limits: g.limits })[0].steps;
        await net.request('turn:play', { steps: stepsToWire(steps) });
        turns++;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
    return { turns, result: null };
  });
  check(played.result !== null, `offline game finishes (${played.turns} human turns, ${JSON.stringify(played.result)})`);
  await page.waitForSelector('#overlay-rematch');
  await page.screenshot({ path: path.join(OUT, '05-over.png') });
  await page.click('#overlay-rematch');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing');
  check(true, 'rematch starts the next game');
  await page.click('#resign');
  await page.click('#resign');
  await page.waitForFunction(() => window.__tg.state?.phase === 'over');
  await page.click('#overlay-rematch ~ button:last-child, .overlay-card button:last-child');
  await page.waitForSelector('#offline-start');
  check(true, 'leaving returns to the setup screen');
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}
