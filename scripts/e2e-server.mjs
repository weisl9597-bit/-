import { createServer } from 'node:http';
import { resolve } from 'node:path';
import next from '../apps/web/node_modules/next/dist/server/next.js';

const hostname = '127.0.0.1';
const port = 3100;
const application = next({ dev: true, dir: resolve('apps/web'), hostname, port });
await application.prepare();

const handler = application.getRequestHandler();
const server = createServer((request, response) => handler(request, response));
await new Promise((accept) => server.listen(port, hostname, accept));
process.stdout.write(`E2E server ready at http://${hostname}:${port}\n`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await new Promise((accept) => server.close(() => accept()));
  await application.close();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => void shutdown().finally(() => process.exit(0)));
}
