// Renders resources/icon.png (1024 px, full-bleed: iOS rounds the corners) and resources/splash.png (2732 px)
// from the four-checker logo. `npm run assets` then turns them into the Xcode asset catalog.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const BG = '#12161d';
const checkers = `
  <circle cx="22" cy="22" r="13" fill="#cfcfcf" stroke="#8c8c8c" stroke-width="3"/>
  <circle cx="42" cy="22" r="13" fill="#d58a3a" stroke="#8a531a" stroke-width="3"/>
  <circle cx="22" cy="42" r="13" fill="#2a2a30" stroke="#55555e" stroke-width="3"/>
  <circle cx="42" cy="42" r="13" fill="#e0c95b" stroke="#9c8420" stroke-width="3"/>`;

const svg = (size, logo) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" fill="${BG}"/>
  <g transform="translate(32 32) scale(${logo}) translate(-32 -32)">${checkers}</g></svg>`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge', headless: true });
try {
  for (const [name, size, logo] of [['icon.png', 1024, 0.86], ['splash.png', 2732, 0.22], ['splash-dark.png', 2732, 0.22]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0">${svg(size, logo)}</body></html>`);
    await page.locator('svg').screenshot({ path: path.join(OUT, name) });
    await page.close();
    console.log(`wrote resources/${name}`);
  }
} finally {
  await browser.close();
}
