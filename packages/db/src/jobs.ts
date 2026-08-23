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

export async function failJob(jobId: string, error: unknown): Promise<void> {
  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });
  if (!job) return;
  const exhausted = job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: jobId },
    data: {
      status: exhausted ? 'FAILED' : 'QUEUED',
      availableAt: exhausted
        ? undefined
        : new Date(Date.now() + Math.min(job.attempts * 30_000, 5 * 60_000)),
      lockedBy: null,
      lockedAt: null,
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}
