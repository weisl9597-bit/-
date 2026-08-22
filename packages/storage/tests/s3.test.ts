import { describe, expect, it } from 'vitest';

import { createS3ObjectStore, type S3CommandClient } from '../src/s3';

describe('S3 object storage adapter', () => {
  it('round-trips uploaded bytes through the configured bucket', async () => {
    const objects = new Map<string, Uint8Array>();
    const client: S3CommandClient = {
      async send(command) {
        const input = command.input as {
          Key?: string;
          Body?: Uint8Array;
        };
        if (command.constructor.name === 'PutObjectCommand') {
          objects.set(input.Key!, input.Body!);
          return {};
        }
        const bytes = objects.get(input.Key!);
        return bytes
          ? { Body: { async transformToByteArray() { return bytes; } } }
          : {};
      },
    };
    const storage = createS3ObjectStore(client, 'designbao-uploads');

    await storage.putObject('uploads/example.xlsx', Buffer.from('xlsx'), 'application/xlsx');
    const loaded = await storage.getObject('uploads/example.xlsx');

    expect(loaded?.toString('utf8')).toBe('xlsx');
  });
});
