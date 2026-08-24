import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const baseURL = 'http://127.0.0.1:3100';
const environment = {
  ...process.env,
  E2E_BYPASS_AUTH: '1',
  SOURCE_AWARE_OPERATIONS_ENABLED: 'true',
  DATABASE_URL: 'postgresql://designbao:designbao_local@127.0.0.1:5432/designbao',
  SESSION_SECRET: 'e2e-only-session-secret-at-least-32-characters',
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_BUCKET: 'designbao-uploads',
  OBJECT_STORAGE_ACCESS_KEY: 'designbao',
  OBJECT_STORAGE_SECRET_KEY: 'designbao_local_only',
  TZ: 'Asia/Shanghai',
};

async function portAlreadyInUse() {
  try {
    await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(serverExited) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (serverExited()) throw new Error('E2E 服务在就绪前退出');
    try {
      const response = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The server is still compiling.
    }
    await new Promise((accept) => setTimeout(accept, 500));
  }
  throw new Error('E2E 服务在 60 秒内未就绪');
}

async function main() {
  if (await portAlreadyInUse()) throw new Error('3100 端口已有服务，拒绝连接旧测试页面');
  let exited = false;
  const server = spawn(process.execPath, [resolve('scripts/e2e-server.mjs')], {
    cwd: process.cwd(), env: environment, stdio: 'inherit', windowsHide: true,
  });
  const serverExit = new Promise((accept) => server.once('exit', (code, signal) => {
    exited = true;
    accept({ code, signal });
  }));

  try {
    await waitUntilReady(() => exited);
    const playwright = spawn(
      process.execPath,
      [resolve('node_modules/@playwright/test/cli.js'), 'test', ...process.argv.slice(2)],
      { cwd: process.cwd(), env: environment, stdio: 'inherit', windowsHide: true },
    );
    const code = await new Promise((accept) => playwright.once('exit', (exitCode) => accept(exitCode ?? 1)));
    if (code !== 0) process.exitCode = Number(code);
  } finally {
    if (!exited) server.kill('SIGTERM');
    await Promise.race([serverExit, new Promise((accept) => setTimeout(accept, 5_000))]);
    if (!exited) server.kill('SIGKILL');
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
