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
    const candidates = await transaction.query<{ id: string }>(
      `
        SELECT "id"
        FROM "Job"
        WHERE "status" = 'QUEUED'
          AND "availableAt" <= $1
          AND "attempts" < "maxAttempts"
        ORDER BY "availableAt" ASC, "createdAt" ASC
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

export async function completeJob(jobId: string): Promise<void> {
  await db.job.updateMany({
    where: { id: jobId, status: 'RUNNING' },
    data: {
      status: 'SUCCEEDED',
      lockedBy: null,
      lockedAt: null,
      lastError: null,
    },
  });
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

