import { randomUUID } from 'node:crypto';
import {
  claimNextJob,
  completeJob,
  failJob,
  requeueOutdatedImportJobs,
  safeErrorMessage,
} from '@designbao/db/jobs';
import { allMetricDefinitions } from '@designbao/metrics/catalog';
import { createConfiguredObjectStore } from '@designbao/storage/s3';
import { formatJobLog } from './job-log';
import { runClaimedJob } from './job-runner';
import { runCalculateMetricsJob } from './jobs/calculate-metrics';
import { runEvaluateRulesJob } from './jobs/evaluate-rules';
import { processImportBatch } from './jobs/import-batch';
import { prismaImportRepository } from './jobs/prisma-import-repository';
import { attemptWithRetryGate, type RetryGateState } from './retry-gate';

const workerId = `designbao-worker-${randomUUID()}`;
const storage = createConfiguredObjectStore();
const formulaVersion = allMetricDefinitions[0]?.formulaVersion ?? 'v3';
const formulaRequeueState: RetryGateState = { completed: false, nextAttemptAt: 0 };
const RETRY_DELAY_MS = 15_000;
let working = false;
let nextPollErrorLogAt = 0;

async function ensureCurrentFormulaJobs(): Promise<void> {
  await attemptWithRetryGate({
    state: formulaRequeueState,
    now: Date.now(),
    retryDelayMs: RETRY_DELAY_MS,
    task: () => requeueOutdatedImportJobs(formulaVersion),
    onSuccess: (requeued) => {
      if (requeued > 0) console.info(`event: imports_requeued count: ${requeued} formulaVersion: ${formulaVersion}`);
    },
    onFailure: (error) => {
      console.error(`event: imports_requeue_retry_scheduled delayMs: ${RETRY_DELAY_MS} error: ${safeErrorMessage(error)}`);
    },
  });
}

async function runOnce(): Promise<void> {
  if (working) return;
  working = true;
  try {
    await ensureCurrentFormulaJobs();
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
    nextPollErrorLogAt = 0;
  } catch (error) {
    const now = Date.now();
    if (now >= nextPollErrorLogAt) {
      console.error(`event: worker_poll_retry_scheduled delayMs: ${RETRY_DELAY_MS} error: ${safeErrorMessage(error)}`);
      nextPollErrorLogAt = now + RETRY_DELAY_MS;
    }
  } finally {
    working = false;
  }
}

async function startWorker(): Promise<void> {
  await runOnce();
  setInterval(() => void runOnce(), 1_000);
}

void startWorker();
