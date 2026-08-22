import { randomUUID } from 'node:crypto';
import { claimNextJob, completeJob, failJob } from '@designbao/db/jobs';
import { createConfiguredObjectStore } from '@designbao/storage/s3';
import { runClaimedJob } from './job-runner';
import { runCalculateMetricsJob } from './jobs/calculate-metrics';
import { runEvaluateRulesJob } from './jobs/evaluate-rules';
import { processImportBatch } from './jobs/import-batch';
import { prismaImportRepository } from './jobs/prisma-import-repository';

const workerId = `designbao-worker-${randomUUID()}`;
const storage = createConfiguredObjectStore();
let working = false;

async function runOnce(): Promise<void> {
  if (working) return;
  working = true;
  try {
    const job = await claimNextJob(workerId);
    if (!job) return;
    try {
      await runClaimedJob(job, {
        importBatch: (batchId) => processImportBatch(batchId, {
          repository: prismaImportRepository,
          storage,
        }),
        calculateMetrics: runCalculateMetricsJob,
        evaluateRules: runEvaluateRulesJob,
      });
      await completeJob(job.id);
    } catch (error) {
      await failJob(job.id, error);
    }
  } finally {
    working = false;
  }
}

void runOnce();
setInterval(() => void runOnce(), 1_000);
