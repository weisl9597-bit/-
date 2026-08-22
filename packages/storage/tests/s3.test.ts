import { afterEach, describe, expect, it, vi } from 'vitest';

const s3ClientCapture = vi.hoisted(() => ({
  options: undefined as Record<string, unknown> | undefined,
}));

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
  return {
    ...actual,
    S3Client: class {
      constructor(options: Record<string, unknown>) {
        s3ClientCapture.options = options;
      }

      async send() {
        return {};
      }
    },
  };
});

import {
  createConfiguredObjectStore,
  createS3ObjectStore,
  type S3CommandClient,
} from '../src/s3';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
  s3ClientCapture.options = undefined;
});

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

  it('uses virtual-hosted addressing when path-style storage is disabled', () => {
    process.env = {
      ...originalEnvironment,
      OBJECT_STORAGE_ENDPOINT: 'https://storage.railway.app',
      OBJECT_STORAGE_REGION: 'auto',
      OBJECT_STORAGE_BUCKET: 'designbao-uploads-example',
      OBJECT_STORAGE_ACCESS_KEY: 'access-key',
      OBJECT_STORAGE_SECRET_KEY: 'secret-key',
      OBJECT_STORAGE_FORCE_PATH_STYLE: 'false',
    };

    createConfiguredObjectStore();

    expect(s3ClientCapture.options?.forcePathStyle).toBe(false);
  });

  it('keeps path-style addressing enabled by default for local MinIO', () => {
    process.env = {
      ...originalEnvironment,
      OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
      OBJECT_STORAGE_REGION: 'us-east-1',
      OBJECT_STORAGE_BUCKET: 'designbao-uploads',
      OBJECT_STORAGE_ACCESS_KEY: 'designbao',
      OBJECT_STORAGE_SECRET_KEY: 'designbao_local_only',
    };
    delete process.env.OBJECT_STORAGE_FORCE_PATH_STYLE;

    createConfiguredObjectStore();

    expect(s3ClientCapture.options?.forcePathStyle).toBe(true);
  });
});
