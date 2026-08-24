import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const scriptPath = new URL('../../../scripts/requeue-business-source-rebuild.ts', import.meta.url);

describe('business source rebuild command', () => {
  it('uses an async main function instead of top-level await for Railway CommonJS execution', async () => {
    const source = await readFile(scriptPath, 'utf8');

    expect(source).toContain('async function main()');
    expect(source).toContain('main().finally');
    expect(source).toContain('.catch((error: unknown)');
    expect(source).not.toMatch(/^const result = await /m);
  });
});
