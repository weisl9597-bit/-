import { sha256 } from '@designbao/importer/hash-file';

export type UploadStatus = 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';

export type UploadRecord = {
  id: string;
  fileName: string;
  fileHash: string;
  objectKey: string;
  dataDate: string;
  uploadedById: string;
  status: UploadStatus;
  totalRows?: number;
  acceptedRows: number;
  errorCount: number;
  warningCount: number;
  failureStage?: string | null;
  failureMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  skippedRows?: number;
  issues?: Array<{
    code: string;
    sourceSheet: string;
    sourceRow: number | null;
    field: string | null;
    message: string;
  }>;
};

export type QueuedUploadInput = Omit<
  UploadRecord,
  'id' | 'status' | 'totalRows' | 'acceptedRows' | 'errorCount' | 'warningCount'
>;

export type UploadHandlerDependencies = {
  authorize(request: Request): Promise<{ userId: string; role: string } | null>;
  findDuplicate(fileHash: string, dataDate: string): Promise<UploadRecord | null>;
  retryDuplicate(batch: UploadRecord): Promise<UploadRecord>;
  putObject(objectKey: string, bytes: Uint8Array, contentType: string): Promise<void>;
  createQueued(input: QueuedUploadInput): Promise<UploadRecord>;
};

export type UploadStatusDependencies = {
  authorize(request: Request): Promise<{ userId: string; role: string } | null>;
  findById(batchId: string): Promise<UploadRecord | null>;
  findLatest(): Promise<UploadRecord | null>;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function validDataDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}

export function createUploadHandler(dependencies: UploadHandlerDependencies) {
  return async function postUpload(request: Request): Promise<Response> {
    const actor = await dependencies.authorize(request);
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (actor.role !== 'ADMIN') return json({ error: 'FORBIDDEN' }, 403);

    const form = await request.formData();
    const file = form.get('file');
    const dataDate = String(form.get('dataDate') ?? '').trim();
    if (!(file instanceof File)) return json({ error: 'FILE_REQUIRED' }, 400);
    if (!validDataDate(dataDate)) return json({ error: 'INVALID_DATA_DATE' }, 400);
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return json({ error: 'XLSX_ONLY' }, 415);
    }
    if (file.size > MAX_FILE_BYTES) return json({ error: 'FILE_TOO_LARGE' }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = sha256(Buffer.from(bytes));
    const duplicate = await dependencies.findDuplicate(fileHash, dataDate);
    if (duplicate) {
      const batch = await dependencies.retryDuplicate(duplicate);
      return json({ error: 'DUPLICATE_FILE', batchId: batch.id, status: batch.status }, 409);
    }

    const objectKey = `uploads/${dataDate}/${fileHash}.xlsx`;
    await dependencies.putObject(
      objectKey,
      bytes,
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    const batch = await dependencies.createQueued({
      fileName: file.name,
      fileHash,
      objectKey,
      dataDate,
      uploadedById: actor.userId,
    });
    return json({ batchId: batch.id, status: 'QUEUED' }, 202);
  };
}

export function createUploadStatusHandler(dependencies: UploadStatusDependencies) {
  return async function getUpload(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const actor = await dependencies.authorize(request);
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (actor.role !== 'ADMIN') return json({ error: 'FORBIDDEN' }, 403);
    const { id } = await context.params;
    const batch = await dependencies.findById(id);
    return batch ? json(batch, 200) : json({ error: 'NOT_FOUND' }, 404);
  };
}

export function createLatestUploadHandler(dependencies: UploadStatusDependencies) {
  return async function getLatestUpload(request: Request): Promise<Response> {
    const actor = await dependencies.authorize(request);
    if (!actor) return json({ error: 'UNAUTHENTICATED' }, 401);
    if (actor.role !== 'ADMIN') return json({ error: 'FORBIDDEN' }, 403);
    return json(await dependencies.findLatest(), 200);
  };
}

