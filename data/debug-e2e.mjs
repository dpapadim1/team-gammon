import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startTestServer } from '../testkit/server.js';

const { puzzles } = JSON.parse(readFileSync('client/puzzles.json', 'utf8'));
const srv = await startTestServer({});
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
page.on('console', (m) => console.log('console', m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
const target = puzzles[0];
const clicksFor = (index) => page.evaluate(async ([p, i]) => {
  const { describePlay } = await import('/client/js/puzzles.js');
  const { Position, OFF } = await import('/engine/index.js');
  const { rulesFor } = await import('/client/js/format.js');
  const rules = rulesFor();
  return describePlay(Position.fromText(rules, p.position), rules.seatIndex.get(p.seat), p.plays[i].steps).steps.map((s) => [s.from, s.to === OFF ? 0 : s.to]);
}, [target, index]);
const playOut = async (index) => {
  const clicks = await clicksFor(index);
  console.log('clicks', index, JSON.stringify(clicks));
  for (const [from, to] of clicks) {
    await page.locator(`rect.hit[data-point="${from}"]`).click();
    await page.locator(to === 0 ? 'rect.hit[data-off]' : `rect.hit[data-point="${to}"]`).click();
  }
  await page.waitForSelector('#verdict');
  console.log('verdict', await page.locator('#verdict').getAttribute('data-kind'), (await page.locator('#verdict h2').textContent()));
};
await page.goto(`${srv.baseUrl}/puzzles`);
await page.waitForSelector('.puzzle-card');
await page.click(`.puzzle-card[data-id="${target.id}"]`);
await page.waitForSelector('svg.board rect.hit.active');
await page.click('#hint');
await playOut(target.plays.length - 1);
console.log('storage after weak', await page.evaluate(() => localStorage.getItem('tg.puzzles')));
await page.click('#all');
console.log('progress', await page.locator('#progress').textContent());
await page.click(`.puzzle-card[data-id="${target.id}"]`);
await page.waitForSelector('svg.board rect.hit.active');
console.log('verdict count after reopen', await page.locator('#verdict').count());
await playOut(0);
await page.waitForSelector('#verdict[data-kind="best"]');
console.log('storage after best', await page.evaluate(() => localStorage.getItem('tg.puzzles')));
await page.click('#all');
console.log('progress', await page.locator('#progress').textContent());
await browser.close();
await srv.close();
