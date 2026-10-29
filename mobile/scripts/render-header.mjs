// App Store header artwork in both accepted sizes, 5244 x 2950 and 3840 x 1646 pixels: logo, name and tagline
// on the left, phones with the app screenshots on the right. Needs `npm run screenshots` first.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'screenshots');
const SHOTS = path.join(ROOT, 'iphone-6.9in-1290x2796');
const OUT = path.join(ROOT, 'header');
const SIZES = [[5244, 2950], [3840, 1646]];

const dataUrl = (name) => {
  const file = path.join(SHOTS, name);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: run npm run screenshots first`);
  return `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
};
const game = dataUrl('2-game.png');
const home = dataUrl('1-home.png');
const puzzles = dataUrl('3-puzzles.png');

const logo = `<svg viewBox="0 0 64 64" class="logo">
  <circle cx="22" cy="22" r="13" fill="#cfcfcf" stroke="#8c8c8c" stroke-width="3"/>
  <circle cx="42" cy="22" r="13" fill="#d58a3a" stroke="#8a531a" stroke-width="3"/>
  <circle cx="22" cy="42" r="13" fill="#2a2a30" stroke="#55555e" stroke-width="3"/>
  <circle cx="42" cy="42" r="13" fill="#e0c95b" stroke="#9c8420" stroke-width="3"/></svg>`;

// Everything is sized in rem = 1% of the canvas height, capped by the width, so both aspect ratios share one layout.
const html = `<!doctype html><html><head><style>
  html { font-size: min(1vh, calc(100vw / 240)); }
  html, body { margin: 0; height: 100%; }
  body { background: radial-gradient(ellipse at 75% 40%, #23304a 0%, #12161d 60%); color: #e8edf5;
    font-family: "Segoe UI", system-ui, sans-serif; display: flex; align-items: center; justify-content: center;
    gap: 9rem; overflow: hidden; }
  .text { max-width: 78rem; }
  .logo { width: 22rem; height: 22rem; display: block; margin-bottom: 4rem; }
  h1 { font-size: 11rem; line-height: 1; margin: 0 0 3.5rem; font-weight: 800; letter-spacing: -0.02em; white-space: nowrap; }
  p { font-size: 4.6rem; line-height: 1.3; margin: 0; color: #a9b4c4; }
  .phones { display: flex; align-items: center; gap: 3.5rem; }
  .phone { height: 72rem; aspect-ratio: 1290 / 2796; border-radius: 5rem; padding: 1.2rem; background: #05070a;
    box-shadow: 0 0 0 0.35rem #3a4252, 0 3rem 8rem rgba(0, 0, 0, 0.55); }
  .phone.big { height: 86rem; }
  .phone img { width: 100%; height: 100%; border-radius: 4rem; display: block; object-fit: cover; object-position: top; }
</style></head><body>
  <div class="text">${logo}<h1>Team Gammon</h1><p>Backgammon for four players in two teams. Pin, block and race your partner home.</p></div>
  <div class="phones">
    <div class="phone"><img src="${home}"></div>
    <div class="phone big"><img src="${game}"></div>
    <div class="phone"><img src="${puzzles}"></div>
  </div>
</body></html>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge', headless: true });
try {
  for (const [width, height] of SIZES) {
    const page = await browser.newPage({ viewport: { width: width / 2, height: height / 2 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.waitForLoadState('load');
    const file = path.join(OUT, `header-${width}x${height}.png`);
    await page.screenshot({ path: file, type: 'png' });
    await page.close();
    console.log(`wrote ${file}`);
  }
} finally {
  await browser.close();
}
