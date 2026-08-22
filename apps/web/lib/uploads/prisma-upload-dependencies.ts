import { db } from '@designbao/db/client';
import { createConfiguredObjectStore } from '@designbao/storage/s3';
import { authenticateRequest } from '../auth/request-actor';
import type {
  QueuedUploadInput,
  UploadHandlerDependencies,
  UploadRecord,
  UploadStatusDependencies,
} from './upload-handler';

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function mapBatch(batch: {
  id: string;
  fileName: string;
  fileHash: string;
  objectKey: string | null;
  dataDate: Date;
  uploadedById: string | null;
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
  totalRows: number;
  acceptedRows: number;
  errorCount: number;
  warningCount: number;
}): UploadRecord {
  return {
    id: batch.id,
    fileName: batch.fileName,
    fileHash: batch.fileHash,
    objectKey: batch.objectKey ?? '',
    dataDate: formatDate(batch.dataDate),
    uploadedById: batch.uploadedById ?? '',
    status: batch.status,
    totalRows: batch.totalRows,
    acceptedRows: batch.acceptedRows,
    errorCount: batch.errorCount,
    warningCount: batch.warningCount,
  };
}

let configuredStorage: ReturnType<typeof createConfiguredObjectStore> | null = null;
function storage() {
  configuredStorage ??= createConfiguredObjectStore();
  return configuredStorage;
}

async function createQueued(input: QueuedUploadInput): Promise<UploadRecord> {
  const batch = await db.$transaction(async (transaction) => {
    const created = await transaction.uploadBatch.create({
      data: {
        fileName: input.fileName,
        fileHash: input.fileHash,
        objectKey: input.objectKey,
        dataDate: dateOnly(input.dataDate),
        uploadedById: input.uploadedById,
        status: 'QUEUED',
      },
    });
    await transaction.job.create({
      data: {
        type: 'IMPORT',
        status: 'QUEUED',
        sourceBatchId: created.id,
        payload: { batchId: created.id },
      },
    });
    return created;
  });
  return mapBatch(batch);
}

export const prismaUploadDependencies: UploadHandlerDependencies = {
  authorize: authenticateRequest,
  async findDuplicate(fileHash, dataDate) {
    const batch = await db.uploadBatch.findUnique({
      where: { fileHash_dataDate: { fileHash, dataDate: dateOnly(dataDate) } },
    });
    return batch ? mapBatch(batch) : null;
  },
  async putObject(objectKey, bytes, contentType) {
    await storage().putObject(objectKey, bytes, contentType);
  },
  createQueued,
};

export const prismaUploadStatusDependencies: UploadStatusDependencies = {
  authorize: authenticateRequest,
  async findById(batchId) {
    const batch = await db.uploadBatch.findUnique({ where: { id: batchId } });
    return batch ? mapBatch(batch) : null;
  },
};
