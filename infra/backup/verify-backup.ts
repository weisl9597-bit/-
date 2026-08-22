import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

export async function inspectBackupFile(file: string): Promise<{ bytes: number; sha256: string }> {
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size === 0) throw new Error('备份文件不存在或为空');
  const hash = createHash('sha256');
  await new Promise<void>((accept, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => accept());
    stream.on('error', reject);
  });
  return { bytes: metadata.size, sha256: hash.digest('hex') };
}

export async function verifyPostgresArchive(file: string): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const process = spawn('pg_restore', ['--list', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorOutput = '';
    process.stderr.on('data', (chunk) => { errorOutput += String(chunk); });
    process.on('error', reject);
    process.on('exit', (code) => code === 0 ? accept() : reject(new Error(errorOutput || `pg_restore 退出码 ${code}`)));
  });
}

async function main() {
  const file = process.argv[2] ? resolve(process.argv[2]) : '';
  if (!file) throw new Error('用法：pnpm tsx infra/backup/verify-backup.ts <database.dump>');
  const result = await inspectBackupFile(file);
  const expectedHash = process.env.BACKUP_SHA256?.trim().toLowerCase();
  if (expectedHash && expectedHash !== result.sha256) throw new Error('备份文件 SHA-256 与预期不一致');
  await verifyPostgresArchive(file);
  process.stdout.write(`备份结构有效：${result.bytes} bytes，SHA-256 ${result.sha256}\n`);
}

if (process.argv[1]?.endsWith('verify-backup.ts')) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
