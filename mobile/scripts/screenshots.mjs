// App Store screenshots of the app bundle: 430 x 932 points at 3x = 1290 x 2796 pixels, a size App Store
// Connect accepts for the 6.9" and 6.7" iPhone slots. PNG with an opaque page background.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from './build-www.mjs';
import { serve } from './serve.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

build();
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await context.newPage();
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), type: 'png' });

try {
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await shot('1-home');

  await page.goto(`${base}/play.html`);
  await page.waitForSelector('#offline-start');
  await page.selectOption('#offline-level', '9');
  await page.evaluate(() => {
    const s = window.__tg.net.services;
    s.config = { ...s.config, timing: { startDelayMs: 20, rollDelayMs: 20, passDelayMs: 20, botThinkMs: 20 } };
  });
  await page.click('#offline-start');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing');
  // Play a few turns so the board shows a game in progress, then stop on our own turn.
  await page.evaluate(async () => {
    const { enumerateTurns, stepsToWire } = await import('/engine/index.js');
    const net = window.__tg.net;
    let turns = 0;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && window.__tg.state.phase === 'playing') {
      const g = net.room.session.game;
      const mine = g.phase === 'move' && g.actor === net.room.rules.seatIndex.get(window.__tg.state.you.seat);
      if (mine) {
        if (turns === 6) return;
        const steps = enumerateTurns(g.position, g.actor, g.dice, { limits: g.limits })[0].steps;
        await net.request('turn:play', { steps: stepsToWire(steps) });
        turns++;
      }
      await new Promise((r) => setTimeout(r, 15));
    }
  });
  await page.waitForTimeout(500);
  await shot('2-game');

  for (const [file, name] of [['3-puzzles', 'puzzles'], ['4-tutorial', 'tutorial'], ['5-rules', 'rules']]) {
    await page.goto(`${base}/client/${name}.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await shot(file);
  }
  console.log(`screenshots in ${OUT}`);
} finally {
  await browser.close();
  server.close();
}
