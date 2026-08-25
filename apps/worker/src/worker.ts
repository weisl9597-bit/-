import { randomUUID } from 'node:crypto';
import { claimNextJob, completeJob, failJob, requeueOutdatedImportJobs } from '@designbao/db/jobs';
import { allMetricDefinitions } from '@designbao/metrics/catalog';
import { createConfiguredObjectStore } from '@designbao/storage/s3';
import { formatJobLog } from './job-log';
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
    console.info(formatJobLog({ event: 'job_claimed', job }));
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
      console.info(formatJobLog({ event: 'job_succeeded', job }));
    } catch (error) {
      const failure = await failJob(job.id, error);
      console.error(formatJobLog({
        event: 'job_failed',
        job,
        error,
        exhausted: failure.exhausted,
      }));
    }
  } finally {
    working = false;
  }
}

async function startWorker(): Promise<void> {
  const formulaVersion = allMetricDefinitions[0]?.formulaVersion ?? 'v3';
  const requeued = await requeueOutdatedImportJobs(formulaVersion);
  if (requeued > 0) console.info(`event: imports_requeued count: ${requeued} formulaVersion: ${formulaVersion}`);
  await runOnce();
  setInterval(() => void runOnce(), 1_000);
}

void startWorker();

