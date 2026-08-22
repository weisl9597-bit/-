import type { ClaimedJob } from '@designbao/db/jobs';

export type JobHandlers = {
  importBatch(batchId: string): Promise<unknown>;
  calculateMetrics(input: { batchId: string; dataDate: string }): Promise<unknown>;
  evaluateRules(input: { batchId: string; dataDate: string }): Promise<unknown>;
};

function dataDate(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'dataDate' in payload) {
    const value = (payload as { dataDate?: unknown }).dataDate;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  throw new Error('Job payload is missing a valid dataDate');
}

export async function runClaimedJob(job: ClaimedJob, handlers: JobHandlers): Promise<void> {
  if (!job.sourceBatchId) throw new Error(`Job ${job.id} is missing sourceBatchId`);
  if (job.type === 'IMPORT') {
    await handlers.importBatch(job.sourceBatchId);
    return;
  }
  const input = { batchId: job.sourceBatchId, dataDate: dataDate(job.payload) };
  if (job.type === 'METRICS') {
    await handlers.calculateMetrics(input);
    return;
  }
  await handlers.evaluateRules(input);
}
