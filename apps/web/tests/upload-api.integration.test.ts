import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createUploadHandler,
  type UploadHandlerDependencies,
  type UploadRecord,
} from '../lib/uploads/upload-handler';

function setup() {
  const batches = new Map<string, UploadRecord>();
  const storedObjects = new Map<string, Buffer>();
  let sequence = 0;
  const dependencies: UploadHandlerDependencies = {
    async authorize() {
      return { userId: 'admin-1', role: 'ADMIN' };
    },
    async findDuplicate(fileHash, dataDate) {
      return [...batches.values()].find(
        (batch) => batch.fileHash === fileHash && batch.dataDate === dataDate,
      ) ?? null;
    },
    async retryDuplicate(batch) {
      return batch;
    },
    async putObject(objectKey, bytes) {
      storedObjects.set(objectKey, Buffer.from(bytes));
    },
    async createQueued(input) {
      sequence += 1;
      const record: UploadRecord = {
        id: `batch-${sequence}`,
        status: 'QUEUED',
        errorCount: 0,
        warningCount: 0,
        acceptedRows: 0,
        ...input,
      };
      batches.set(record.id, record);
      return record;
    },
  };
  return { dependencies, batches, storedObjects };
}

async function uploadRequest(fileName = 'designbao.xlsx') {
  const buffer = await readFile(
    resolve('packages/test-fixtures/excel/designbao-valid.xlsx'),
  );
  const form = new FormData();
  form.set('file', new File([buffer], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  form.set('dataDate', '2026-08-21');
  return new Request('http://localhost/api/admin/uploads', {
    method: 'POST',
    body: form,
  });
}

describe('admin upload API', () => {
  it('stores an xlsx once and immediately returns a queued batch', async () => {
    const { dependencies, storedObjects } = setup();
    const handler = createUploadHandler(dependencies);

    const first = await handler(await uploadRequest());
    const duplicate = await handler(await uploadRequest());

    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ batchId: 'batch-1', status: 'QUEUED' });
    expect(duplicate.status).toBe(409);
    expect(storedObjects.size).toBe(1);
  });

  it('rejects non-xlsx files before creating a batch', async () => {
    const { dependencies, batches } = setup();
    const handler = createUploadHandler(dependencies);

    const response = await handler(await uploadRequest('designbao.csv'));

    expect(response.status).toBe(415);
    expect(batches.size).toBe(0);
  });

  it('requeues a recoverable duplicate batch before returning its status', async () => {
    const { dependencies, batches } = setup();
    const handler = createUploadHandler(dependencies);
    await handler(await uploadRequest());
    const existing = batches.get('batch-1')!;
    existing.status = 'PROCESSING';
    dependencies.retryDuplicate = async (batch) => ({ ...batch, status: 'QUEUED' });

    const response = await handler(await uploadRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'DUPLICATE_FILE',
      batchId: 'batch-1',
      status: 'QUEUED',
    });
  });
});
