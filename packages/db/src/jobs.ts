import { db } from './client';

export type ClaimedJob = {
  id: string;
  type: 'IMPORT' | 'METRICS' | 'RULES';
  status: 'RUNNING';
  sourceBatchId: string | null;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  lockedBy: string;
  lockedAt: Date;
};

export type JobTransaction = {
  query<T>(sql: string, parameters: unknown[]): Promise<T[]>;
  execute(sql: string, parameters: unknown[]): Promise<void>;
};

export type JobDatabase = {
  transaction<T>(operation: (transaction: JobTransaction) => Promise<T>): Promise<T>;
};

const prismaJobDatabase: JobDatabase = {
  transaction(operation) {
    return db.$transaction(async (transaction) =>
      operation({
        async query<T>(sql: string, parameters: unknown[]): Promise<T[]> {
          return transaction.$queryRawUnsafe<T[]>(sql, ...parameters);
        },
        async execute(sql: string, parameters: unknown[]): Promise<void> {
          await transaction.$executeRawUnsafe(sql, ...parameters);
        },
      }),
    );
  },
};

export async function claimNextJobWithDatabase(
  workerId: string,
  database: JobDatabase,
  now = new Date(),
): Promise<ClaimedJob | null> {
  return database.transaction(async (transaction) => {
    const staleBefore = new Date(now.getTime() - 15 * 60_000);
    await transaction.execute(
      `
        UPDATE "Job"
        SET "status" = 'FAILED',
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "lastError" = COALESCE("lastError", 'Worker stopped before the job completed'),
            "updatedAt" = $1
        WHERE "status" = 'RUNNING'
          AND "lockedAt" <= $2
          AND "attempts" >= "maxAttempts"
      `,
      [now, staleBefore],
    );
    await transaction.execute(
      `
        UPDATE "Job"
        SET "status" = 'QUEUED',
            "availableAt" = $1,
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "lastError" = 'Worker stopped before the job completed',
            "updatedAt" = $1
        WHERE "status" = 'RUNNING'
          AND "lockedAt" <= $2
          AND "attempts" < "maxAttempts"
      `,
      [now, staleBefore],
    );
    const candidates = await transaction.query<{ id: string }>(
      `
        SELECT candidate."id"
        FROM "Job" AS candidate
        WHERE candidate."status" = 'QUEUED'
          AND candidate."availableAt" <= $1
          AND candidate."attempts" < candidate."maxAttempts"
          AND (
            candidate."type" <> 'RULES'
            OR EXISTS (
              SELECT 1
              FROM "Job" AS metrics
              WHERE metrics."type" = 'METRICS'
                AND metrics."sourceBatchId" = candidate."sourceBatchId"
                AND metrics."status" = 'SUCCEEDED'
            )
          )
        ORDER BY candidate."availableAt" ASC, candidate."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
      [now],
    );
    const candidate = candidates[0];
    if (!candidate) return null;

    const claimed = await transaction.query<ClaimedJob>(
      `
        UPDATE "Job"
        SET "status" = 'RUNNING',
            "lockedBy" = $1,
            "lockedAt" = $2,
            "attempts" = "attempts" + 1,
            "updatedAt" = $2
        WHERE "id" = $3
        RETURNING
          "id", "type", "status", "sourceBatchId", "payload",
          "attempts", "maxAttempts", "lockedBy", "lockedAt"
      `,
      [workerId, now, candidate.id],
    );
    return claimed[0] ?? null;
  });
}

export function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  return claimNextJobWithDatabase(workerId, prismaJobDatabase, new Date());
}

export async function requeueOutdatedMetricJobsWithDatabase(
  formulaVersion: string,
  database: JobDatabase,
  now = new Date(),
): Promise<number> {
  return database.transaction(async (transaction) => {
    const jobs = await transaction.query<{ id: string }>(
      `
        UPDATE "Job" AS job
        SET "status" = 'QUEUED',
            "attempts" = 0,
            "availableAt" = $1,
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = $1
        WHERE job."type" = 'METRICS'
          AND job."status" IN ('SUCCEEDED', 'FAILED')
          AND EXISTS (
            SELECT 1
            FROM "UploadBatch" AS batch
            WHERE batch."id" = job."sourceBatchId"
              AND batch."status" = 'SUCCEEDED'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "MetricSnapshot" AS snapshot
            WHERE snapshot."sourceBatchId" = job."sourceBatchId"
              AND snapshot."formulaVersion" = $2
          )
        RETURNING job."id"
      `,
      [now, formulaVersion],
    );
    return jobs.length;
  });
}

export function requeueOutdatedMetricJobs(formulaVersion: string): Promise<number> {
  return requeueOutdatedMetricJobsWithDatabase(
    formulaVersion,
    prismaJobDatabase,
    new Date(),
  );
}

export async function requeueOutdatedImportJobsWithDatabase(
  formulaVersion: string,
  database: JobDatabase,
  now = new Date(),
): Promise<number> {
  return database.transaction(async (transaction) => {
    const jobs = await transaction.query<{ id: string }>(
      `
        UPDATE "Job" AS job
        SET "status" = 'QUEUED',
            "attempts" = 0,
            "availableAt" = $1,
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = $1
        WHERE job."type" = 'IMPORT'
          AND job."status" IN ('SUCCEEDED', 'FAILED')
          AND EXISTS (
            SELECT 1
            FROM "UploadBatch" AS batch
            WHERE batch."id" = job."sourceBatchId"
              AND batch."status" = 'SUCCEEDED'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "MetricSnapshot" AS snapshot
            WHERE snapshot."sourceBatchId" = job."sourceBatchId"
              AND snapshot."formulaVersion" = $2
          )
        RETURNING job."id"
      `,
      [now, formulaVersion],
    );
    return jobs.length;
  });
}

export function requeueOutdatedImportJobs(formulaVersion: string): Promise<number> {
  return requeueOutdatedImportJobsWithDatabase(
    formulaVersion,
    prismaJobDatabase,
    new Date(),
  );
}

export type BusinessSourceRebuildQueueResult = {
  rebuildVersion: string;
  queued: number;
  requeued: Array<{ batchId: string; dataDate: string }>;
};

function jsonObject(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function rebuildDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function requeueBusinessSourceRebuildWithDatabase(
  rebuildVersion: string,
  database: JobDatabase,
  now = new Date(),
): Promise<BusinessSourceRebuildQueueResult> {
  return database.transaction(async (transaction) => {
    const batches = await transaction.query<{
      batchId: string;
      dataDate: Date | string;
      metricsJobId: string;
      metricsPayload: unknown;
      rulesJobId: string;
      rulesPayload: unknown;
    }>(
      `
        SELECT batch."id" AS "batchId", batch."dataDate" AS "dataDate",
               metrics."id" AS "metricsJobId", metrics."payload" AS "metricsPayload",
               rules."id" AS "rulesJobId", rules."payload" AS "rulesPayload"
        FROM "UploadBatch" AS batch
        INNER JOIN "Job" AS metrics
          ON metrics."sourceBatchId" = batch."id" AND metrics."type" = 'METRICS'
        INNER JOIN "Job" AS rules
          ON rules."sourceBatchId" = batch."id" AND rules."type" = 'RULES'
        WHERE batch."status" = 'SUCCEEDED'
        ORDER BY batch."dataDate" ASC, batch."createdAt" ASC
      `,
      [],
    );

    const requeued: Array<{ batchId: string; dataDate: string }> = [];
    for (const [index, batch] of batches.entries()) {
      const dataDate = rebuildDate(batch.dataDate);
      const metricsPayload = {
        ...jsonObject(batch.metricsPayload), dataDate, rebuildVersion,
      };
      const rulesPayload = {
        ...jsonObject(batch.rulesPayload), dataDate, rebuildVersion,
      };
      const availableAt = new Date(now.getTime() + index * 1_000);
      await transaction.execute(
        `
          UPDATE "Job"
          SET "payload" = $1::jsonb, "status" = 'QUEUED', "attempts" = 0,
              "availableAt" = $2, "lockedBy" = NULL, "lockedAt" = NULL,
              "lastError" = NULL, "updatedAt" = $3
          WHERE "id" = $4
        `,
        [JSON.stringify(metricsPayload), availableAt, now, batch.metricsJobId],
      );
      await transaction.execute(
        `UPDATE "Job" SET "payload" = $1::jsonb, "updatedAt" = $2 WHERE "id" = $3`,
        [JSON.stringify(rulesPayload), now, batch.rulesJobId],
      );
      requeued.push({ batchId: batch.batchId, dataDate });
    }
    return { rebuildVersion, queued: requeued.length, requeued };
  });
}

export function requeueBusinessSourceRebuild(
  rebuildVersion = 'business-source-v2',
): Promise<BusinessSourceRebuildQueueResult> {
  return requeueBusinessSourceRebuildWithDatabase(rebuildVersion, prismaJobDatabase, new Date());
}

export type FailJobResult = {
  exhausted: boolean;
  batchId: string | null;
};

export function safeErrorMessage(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/[\r\n]+/g, ' ')
    .replace(
      /\b(DATABASE_URL|OBJECT_STORAGE_[A-Z_]+|PASSWORD|SECRET|TOKEN|API_KEY)\s*=\s*\S+/gi,
      '$1=***',
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi, '$1***@')
    .trim();
  return (message || 'Unknown worker error').slice(0, 500);
}

export async function completeJobWithDatabase(
  jobId: string,
  database: JobDatabase,
  now = new Date(),
): Promise<void> {
  await database.transaction(async (transaction) => {
    const jobs = await transaction.query<{
      type: ClaimedJob['type'];
      sourceBatchId: string | null;
    }>(
      `
        SELECT "type", "sourceBatchId"
        FROM "Job"
        WHERE "id" = $1
          AND "status" = 'RUNNING'
        FOR UPDATE
      `,
      [jobId],
    );
    const job = jobs[0];
    if (!job) return;

    await transaction.execute(
      `
        UPDATE "Job"
        SET "status" = 'SUCCEEDED',
            "lockedBy" = NULL,
            "lockedAt" = NULL,
            "lastError" = NULL,
            "updatedAt" = $1
        WHERE "id" = $2
          AND "status" = 'RUNNING'
      `,
      [now, jobId],
    );

    if (job.type === 'IMPORT' && job.sourceBatchId) {
      await transaction.execute(
        `
          UPDATE "Job"
          SET "status" = 'QUEUED',
              "attempts" = 0,
              "availableAt" = $1,
              "lockedBy" = NULL,
              "lockedAt" = NULL,
              "lastError" = NULL,
              "updatedAt" = $1
          WHERE "type" = 'METRICS'
            AND "sourceBatchId" = $2
            AND "status" IN ('SUCCEEDED', 'FAILED')
        `,
        [now, job.sourceBatchId],
      );
    }

    if (job.type === 'METRICS' && job.sourceBatchId) {
      await transaction.execute(
        `
          UPDATE "Job"
          SET "status" = 'QUEUED',
              "attempts" = 0,
              "availableAt" = $1,
              "lockedBy" = NULL,
              "lockedAt" = NULL,
              "lastError" = NULL,
              "updatedAt" = $1
          WHERE "type" = 'RULES'
            AND "sourceBatchId" = $2
            AND "status" IN ('SUCCEEDED', 'FAILED')
        `,
        [now, job.sourceBatchId],
      );
    }
  });
}

export function completeJob(jobId: string): Promise<void> {
  return completeJobWithDatabase(jobId, prismaJobDatabase, new Date());
}

export async function failJobWithDatabase(
  jobId: string,
  error: unknown,
  database: JobDatabase,
  now = new Date(),
): Promise<FailJobResult> {
  return database.transaction(async (transaction) => {
    const jobs = await transaction.query<{
      type: ClaimedJob['type'];
      sourceBatchId: string | null;
      attempts: number;
      maxAttempts: number;
    }>(
      `
        SELECT "type", "sourceBatchId", "attempts", "maxAttempts"
        FROM "Job"
        WHERE "id" = $1
        FOR UPDATE
      `,
      [jobId],
    );
    const job = jobs[0];
    if (!job) return { exhausted: false, batchId: null };

    const exhausted = job.attempts >= job.maxAttempts;
    const message = safeErrorMessage(error);
    if (exhausted) {
      await transaction.execute(
        `
          UPDATE "Job"
          SET "status" = 'FAILED',
              "lockedBy" = NULL,
              "lockedAt" = NULL,
              "lastError" = $1,
              "updatedAt" = $2
          WHERE "id" = $3
        `,
        [message, now, jobId],
      );
    } else {
      const availableAt = new Date(
        now.getTime() + Math.min(job.attempts * 30_000, 5 * 60_000),
      );
      await transaction.execute(
        `
          UPDATE "Job"
          SET "status" = 'QUEUED',
              "availableAt" = $1,
              "lockedBy" = NULL,
              "lockedAt" = NULL,
              "lastError" = $2,
              "updatedAt" = $3
          WHERE "id" = $4
        `,
        [availableAt, message, now, jobId],
      );
    }

    if (exhausted && job.type === 'IMPORT' && job.sourceBatchId) {
      await transaction.execute(
        `
          UPDATE "UploadBatch"
          SET "status" = 'FAILED',
              "failureStage" = 'IMPORT',
              "failureMessage" = $1,
              "finishedAt" = $2,
              "updatedAt" = $2
          WHERE "id" = $3
            AND "status" <> 'SUCCEEDED'
        `,
        [message, now, job.sourceBatchId],
      );
    }

    return { exhausted, batchId: job.sourceBatchId };
  });
}

export function failJob(jobId: string, error: unknown): Promise<FailJobResult> {
  return failJobWithDatabase(jobId, error, prismaJobDatabase, new Date());
}

