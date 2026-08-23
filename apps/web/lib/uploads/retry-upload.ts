export type RecoverableUpload = {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED';
};

export type ImportJobState = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
};

export type RetryUploadStore = {
  findImportJob(batchId: string): Promise<ImportJobState | null>;
  reset(batchId: string, jobId: string): Promise<void>;
};

export async function retryRecoverableUpload<T extends RecoverableUpload>(
  batch: T,
  store: RetryUploadStore,
): Promise<T> {
  if (batch.status !== 'PROCESSING' && batch.status !== 'FAILED') return batch;
  const job = await store.findImportJob(batch.id);
  if (!job) return batch;
  const exhaustedProcessing = batch.status === 'PROCESSING' && job.status === 'FAILED';
  const completedFailedBatch = batch.status === 'FAILED' &&
    (job.status === 'FAILED' || job.status === 'SUCCEEDED');
  if (!exhaustedProcessing && !completedFailedBatch) return batch;

  await store.reset(batch.id, job.id);
  return { ...batch, status: 'QUEUED' };
}
