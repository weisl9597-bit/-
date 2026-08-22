import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type ProductionWebDependencies = {
  bootstrapAdmin(): Promise<void>;
  serveWeb(): Promise<void>;
};

export async function startProductionWeb(
  dependencies: ProductionWebDependencies,
): Promise<void> {
  await dependencies.bootstrapAdmin();
  await dependencies.serveWeb();
}

function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} 退出（code=${code ?? 'null'}, signal=${signal ?? 'none'}）`));
    });
  });
}

async function main(): Promise<void> {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const node = process.execPath;
  await startProductionWeb({
    bootstrapAdmin: () => run(node, [
      path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(repositoryRoot, 'scripts', 'bootstrap-admin.ts'),
    ], repositoryRoot),
    serveWeb: () => run(node, [
      path.join(repositoryRoot, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'),
      'start',
      path.join(repositoryRoot, 'apps', 'web'),
    ], repositoryRoot),
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
