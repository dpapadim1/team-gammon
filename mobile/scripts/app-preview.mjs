// App Store app preview: a ~25 s portrait video of the app bundle at 886 x 1920 (443 x 960 points at 2x), H.264
// High 4.0, 30 fps, with a silent stereo AAC track (App Store Connect wants an audio track). One file fits
// every current iPhone slot (6.9-inch and 6.3-inch "iPhone with Dynamic Island").
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { build } from './build-www.mjs';
import { serve } from './serve.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots', 'app-preview');
const FILE = path.join(OUT, 'app-preview-886x1920.mp4');
const FRAMES = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-preview-'));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

build();
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 443, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

const frames = [];
const cdp = await context.newCDPSession(page);
cdp.on('Page.screencastFrame', ({ data, sessionId }) => {
  const file = path.join(FRAMES, `${String(frames.length).padStart(5, '0')}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  frames.push({ file, t: Date.now() });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});

try {
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, maxWidth: 886, maxHeight: 1920 });
  const start = Date.now();
  await pause(2500);

  await page.click('#play-offline');
  await page.waitForSelector('#offline-start');
  await pause(1200);
  await page.selectOption('#offline-level', '9');
  await page.evaluate(() => {
    const s = window.__tg.net.services;
    s.config = { ...s.config, timing: { startDelayMs: 300, rollDelayMs: 350, passDelayMs: 350, botThinkMs: 450 } };
  });
  await pause(800);
  await page.click('#offline-start');
  await page.waitForFunction(() => window.__tg.state?.phase === 'playing');

  // Our seat plays the engine's first legal turn after a human-looking pause; the three bots play themselves.
  await page.evaluate(async () => {
    const { enumerateTurns, stepsToWire } = await import('/engine/index.js');
    const net = window.__tg.net;
    const until = Date.now() + 13000;
    while (Date.now() < until && window.__tg.state.phase === 'playing') {
      const g = net.room.session.game;
      if (g.phase === 'move' && g.actor === net.room.rules.seatIndex.get(window.__tg.state.you.seat)) {
        await new Promise((r) => setTimeout(r, 900));
        const steps = enumerateTurns(g.position, g.actor, g.dice, { limits: g.limits })[0].steps;
        await net.request('turn:play', { steps: stepsToWire(steps) });
      }
      await new Promise((r) => setTimeout(r, 30));
    }
  });

  for (const name of ['puzzles', 'tutorial']) {
    await page.goto(`${base}/client/${name}.html`);
    await page.waitForLoadState('networkidle');
    await pause(2800);
  }
  await page.goto(`${base}/`);
  await page.waitForLoadState('networkidle');
  await pause(1500);
  await cdp.send('Page.stopScreencast');
  const end = Date.now();

  // Each frame lasts until the next one; ffmpeg turns that into constant 30 fps.
  const list = frames.filter((f) => f.t >= start - 1000).map((f, i, a) => {
    const next = i + 1 < a.length ? a[i + 1].t : end;
    return `file '${f.file.replaceAll('\\', '/')}'\nduration ${(Math.max(next - f.t, 1) / 1000).toFixed(3)}`;
  });
  const listFile = path.join(FRAMES, 'list.txt');
  fs.writeFileSync(listFile, `${list.join('\n')}\nfile '${frames.at(-1).file.replaceAll('\\', '/')}'\n`);
  const seconds = Math.min(29.5, (end - start) / 1000);
  const run = spawnSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', 'scale=886:1920:flags=lanczos,fps=30,format=yuv420p',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.0', '-b:v', '10M', '-minrate', '10M', '-maxrate', '10M', '-bufsize', '10M', '-x264-params', 'nal-hrd=cbr',
    '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-t', String(seconds), '-movflags', '+faststart', FILE,
  ], { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('ffmpeg failed');
  console.log(`${frames.length} frames, ${seconds.toFixed(1)} s -> ${FILE}`);
} finally {
  await browser.close();
  server.close();
  fs.rmSync(FRAMES, { recursive: true, force: true });
}
