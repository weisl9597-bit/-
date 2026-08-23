import { safeErrorMessage, type ClaimedJob } from '@designbao/db/jobs';

type JobLogInput =
  | {
      event: 'job_claimed' | 'job_succeeded';
      job: ClaimedJob;
    }
  | {
      event: 'job_failed';
      job: ClaimedJob;
      error: unknown;
      exhausted: boolean;
    };

export function formatJobLog(input: JobLogInput): string {
  const details: Record<string, unknown> = {
    event: input.event,
    jobId: input.job.id,
    jobType: input.job.type,
    batchId: input.job.sourceBatchId,
    attempt: input.job.attempts,
    maxAttempts: input.job.maxAttempts,
  };
  if (input.event === 'job_failed') {
    details.exhausted = input.exhausted;
    details.error = safeErrorMessage(input.error);
  }
  return JSON.stringify(details);
}

