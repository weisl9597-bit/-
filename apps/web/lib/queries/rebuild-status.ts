import { db } from '@designbao/db/client';

export type BusinessSourceRebuildStatus = {
  state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  total: number;
  completed: number;
  failed: number;
  lastSuccessfulDate: string | null;
};

export type TaggedRebuildJob = {
  batchId: string;
  dataDate: string;
  type: 'METRICS' | 'RULES';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  attempts: number;
  maxAttempts: number;
  updatedAt: Date;
  rebuildVersion: string;
};

export type BusinessSourceRebuildRepository = {
  listTaggedJobs(): Promise<TaggedRebuildJob[]>;
};

function payloadVersion(value: unknown): string | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).rebuildVersion === 'string'
    ? (value as Record<string, string>).rebuildVersion ?? null
    : null;
}

const prismaBusinessSourceRebuildRepository: BusinessSourceRebuildRepository = {
  async listTaggedJobs() {
    const rows = await db.job.findMany({
      where: { type: { in: ['METRICS', 'RULES'] }, sourceBatchId: { not: null } },
      select: {
        sourceBatchId: true, type: true, status: true, attempts: true,
        maxAttempts: true, updatedAt: true, payload: true,
        sourceBatch: { select: { dataDate: true } },
      },
    });
    return rows.flatMap((row): TaggedRebuildJob[] => {
      const rebuildVersion = payloadVersion(row.payload);
      if (!row.sourceBatchId || !row.sourceBatch || !rebuildVersion
        || (row.type !== 'METRICS' && row.type !== 'RULES')) return [];
      return [{
        batchId: row.sourceBatchId,
        dataDate: row.sourceBatch.dataDate.toISOString().slice(0, 10),
        type: row.type,
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        updatedAt: row.updatedAt,
        rebuildVersion,
      }];
    });
  },
};

export async function getBusinessSourceRebuildStatus(
  repository: BusinessSourceRebuildRepository = prismaBusinessSourceRebuildRepository,
): Promise<BusinessSourceRebuildStatus> {
  const rows = (await repository.listTaggedJobs())
    .filter((row) => row.rebuildVersion === 'business-source-v2');
  if (rows.length === 0) {
    return { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null };
  }
  const batches = new Map<string, TaggedRebuildJob[]>();
  for (const row of rows) {
    const values = batches.get(row.batchId) ?? [];
    values.push(row);
    batches.set(row.batchId, values);
  }
  let completed = 0;
  let failed = 0;
  const successfulDates: string[] = [];
  for (const values of batches.values()) {
    const latest = (type: TaggedRebuildJob['type']) => values
      .filter((row) => row.type === type)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
    const metrics = latest('METRICS');
    const rules = latest('RULES');
    const exhausted = [metrics, rules].some((row) => (
      row?.status === 'FAILED' && row.attempts >= row.maxAttempts
    ));
    if (exhausted) {
      failed += 1;
      continue;
    }
    if (metrics?.status === 'SUCCEEDED' && rules?.status === 'SUCCEEDED'
      && rules.updatedAt >= metrics.updatedAt) {
      completed += 1;
      successfulDates.push(values[0]!.dataDate);
    }
  }
  const total = batches.size;
  const state = failed > 0 ? 'FAILED'
    : completed === total ? 'SUCCEEDED'
      : 'RUNNING';
  return {
    state, total, completed, failed,
    lastSuccessfulDate: successfulDates.sort().at(-1) ?? null,
  };
}

