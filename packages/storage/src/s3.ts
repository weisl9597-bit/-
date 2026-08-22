import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export type S3CommandClient = {
  send(command: { input: unknown }): Promise<unknown>;
};

export type ObjectStore = {
  putObject(
    objectKey: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>;
  getObject(objectKey: string): Promise<Buffer | null>;
};

type StreamingBody = {
  transformToByteArray(): Promise<Uint8Array>;
};

export function createS3ObjectStore(
  client: S3CommandClient,
  bucket: string,
): ObjectStore {
  return {
    async putObject(objectKey, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: objectKey,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    },

    async getObject(objectKey) {
      const result = (await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
      )) as { Body?: StreamingBody };
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    },
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function createConfiguredObjectStore(): ObjectStore {
  const client = new S3Client({
    endpoint: requiredEnvironment('OBJECT_STORAGE_ENDPOINT'),
    region: requiredEnvironment('OBJECT_STORAGE_REGION'),
    forcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: requiredEnvironment('OBJECT_STORAGE_ACCESS_KEY'),
      secretAccessKey: requiredEnvironment('OBJECT_STORAGE_SECRET_KEY'),
    },
  });
  return createS3ObjectStore(
    client as S3CommandClient,
    requiredEnvironment('OBJECT_STORAGE_BUCKET'),
  );
}
