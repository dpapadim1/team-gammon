// Assembles mobile/www, the web bundle shipped inside the app. The layout mirrors the repository
// (www/client, www/engine, www/bots, www/server) so the shared modules' relative imports work unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(MOBILE, '..');
const WWW = path.join(MOBILE, 'www');
export const ONLINE_ORIGIN = 'https://www.team-gammon.com';

// Server modules that run offline in the app; none of them touch the network, the database or Node-only APIs
// other than node:crypto, which the page maps to a browser shim.
const SERVER_MODULES = ['room.js', 'gameSession.js', 'clock.js', 'errors.js', 'validate.js', 'ratings.js', 'config.js'];
// Node built-ins imported by the shared modules, replaced with small browser versions from mobile/src/js/shims.
const NODE_SHIMS = { 'node:crypto': 'crypto.js', 'node:fs': 'fs.js', 'node:url': 'url.js' };
const LOCAL_PAGES = ['rules', 'tutorial', 'puzzles', 'privacy', 'terms', 'cookies'];
// Pages that only work against the server stay out of the bundle.
const ONLINE_ONLY = new Set(['index.html', 'leaderboard.html', 'js/leaderboardPage.js', 'js/main.js', 'js/api.js']);

function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (!filter(src)) continue;
    if (entry.isDirectory()) copyDir(src, dst, filter);
    else fs.copyFileSync(src, dst);
  }
}

// Server routes such as /rules become bundled files; pages that need the server open the website.
export function rewriteLinks(html) {
  return html.replace(/href="\/([a-z]*)"/g, (match, page) => {
    if (page === '') return 'href="/index.html"';
    if (LOCAL_PAGES.includes(page)) return `href="/client/${page}.html"`;
    if (page === 'leaderboard') return `href="${ONLINE_ORIGIN}/leaderboard"`;
    return match;
  });
}

// Import maps need iOS 16.4, so the Node built-in specifiers are rewritten to the shims instead.
export function rewriteNodeImports(source) {
  return source.replace(/(from\s+|import\s+)'(node:[a-z]+)'/g, (match, keyword, spec) => {
    if (!NODE_SHIMS[spec]) throw new Error(`no browser shim for ${spec}`);
    return `${keyword}'/app/js/shims/${NODE_SHIMS[spec]}'`;
  });
}

function rewriteDir(dir, fn, ext) {
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(ext)) continue;
    const full = path.join(dir, file);
    fs.writeFileSync(full, fn(fs.readFileSync(full, 'utf8')));
  }
}

export function build() {
  fs.rmSync(WWW, { recursive: true, force: true });
  fs.mkdirSync(WWW, { recursive: true });

  const clientDir = path.join(ROOT, 'client');
  copyDir(clientDir, path.join(WWW, 'client'), (src) => !ONLINE_ONLY.has(path.relative(clientDir, src).replaceAll('\\', '/')));
  rewriteDir(path.join(WWW, 'client'), rewriteLinks, '.html');

  copyDir(path.join(ROOT, 'engine'), path.join(WWW, 'engine'));
  copyDir(path.join(ROOT, 'bots'), path.join(WWW, 'bots'), (src) => src.endsWith('.js'));
  rewriteDir(path.join(WWW, 'bots'), rewriteNodeImports, '.js');
  fs.mkdirSync(path.join(WWW, 'server'), { recursive: true });
  for (const file of SERVER_MODULES) fs.copyFileSync(path.join(ROOT, 'server', file), path.join(WWW, 'server', file));
  rewriteDir(path.join(WWW, 'server'), rewriteNodeImports, '.js');
  fs.mkdirSync(path.join(WWW, 'models'), { recursive: true });
  const champion = path.join(ROOT, 'models', 'champion.json');
  if (fs.existsSync(champion)) fs.copyFileSync(champion, path.join(WWW, 'models', 'champion.json'));
  else console.warn('models/champion.json is missing: bot levels 8 and 9 will play like level 7');

  const src = path.join(MOBILE, 'src');
  for (const file of fs.readdirSync(src)) if (file.endsWith('.html')) fs.copyFileSync(path.join(src, file), path.join(WWW, file));
  copyDir(path.join(src, 'js'), path.join(WWW, 'app', 'js'));
  copyDir(path.join(src, 'css'), path.join(WWW, 'app', 'css'));
  return WWW;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`built ${path.relative(ROOT, build())}`);
}
