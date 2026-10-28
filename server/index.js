import { createServer } from './app.js';

const server = createServer();
const port = await server.listen();
console.log(`team-gammon listening on port ${port}${server.config.production ? ' (production)' : ''}`);

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    console.log(`${signal} received, shutting down`);
    await server.close();
    process.exit(0);
  });
}
