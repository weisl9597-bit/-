import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectBackupFile } from './verify-backup';

describe('backup verifier', () => {
  it('reports file size and SHA-256 before invoking PostgreSQL tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'designbao-backup-test-'));
    const file = join(directory, 'database.dump');
    await writeFile(file, 'verified-backup');
    await expect(inspectBackupFile(file)).resolves.toEqual({
      bytes: 15,
      sha256: 'd236906afac4baaba89924427135f1f0f5d22fbb1c46a0e176e276aabb215add',
    });
  });
});
