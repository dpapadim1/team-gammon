// Serves mobile/www the way the app's web view does, for trying the bundle in a desktop browser.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WWW = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'www');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function serve(port = 8100) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = path.normalize(path.join(WWW, decodeURIComponent(url.pathname)));
    if (!file.startsWith(WWW)) {
      res.writeHead(403).end();
      return;
    }
    // Like Capacitor: paths without an extension fall back to the start page.
    if (!path.extname(file)) file = path.join(WWW, 'index.html');
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8100);
  await serve(port);
  console.log(`serving ${WWW} on http://127.0.0.1:${port}/`);
}
