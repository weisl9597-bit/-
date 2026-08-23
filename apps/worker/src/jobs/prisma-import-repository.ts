import { db } from '@designbao/db/client';
import { Prisma } from '@prisma/client';
import { buildBulkImportPlan } from './bulk-import-plan';
import {
  upsertMerchants,
  upsertOrganizations,
  upsertProjects,
} from './prisma-bulk-upsert';
import type {
  ImportBatchRecord,
  ImportBatchRepository,
  PersistFailedBatchInput,
  PersistSuccessfulBatchInput,
} from './import-batch';

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export { buildOrganizationPaths } from './bulk-import-plan';

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function rawRows(input: PersistFailedBatchInput | PersistSuccessfulBatchInput) {
  const canonicalByRow = 'records' in input
    ? new Map(input.records.map((record) => [record.sourceRow, record]))
    : new Map<number, never>();
  return input.rawRows.map((row) => ({
    batchId: input.batchId,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    raw: json(row.raw),
    canonical: canonicalByRow.has(row.sourceRow)
      ? json(canonicalByRow.get(row.sourceRow))
      : undefined,
  }));
}

function issueRows(
  batchId: string,
  issues: Array<{
    sourceSheet: string;
    sourceRow: number;
    field: string;
    code: string;
    severity: 'ERROR' | 'WARNING';
    message: string;
    rawValue: unknown;
  }>,
) {
  return issues.map((item) => ({
    batchId,
    sourceSheet: item.sourceSheet,
    sourceRow: item.sourceRow,
    field: item.field,
    code: item.code,
    severity: item.severity,
    message: item.message,
    rawValue: item.rawValue === null ? Prisma.JsonNull : json(item.rawValue),
  }));
}

export function createPrismaImportRepository(database: typeof db): ImportBatchRepository {
  return {
  async getBatch(batchId): Promise<ImportBatchRecord | null> {
    const batch = await database.uploadBatch.findUnique({ where: { id: batchId } });
    if (!batch?.objectKey) return null;
    return {
      id: batch.id,
      status: batch.status,
      objectKey: batch.objectKey,
      dataDate: formatDate(batch.dataDate),
      totalRows: batch.totalRows,
      acceptedRows: batch.acceptedRows,
      errorCount: batch.errorCount,
      warningCount: batch.warningCount,
    };
  },

  async markProcessing(batchId) {
    await database.uploadBatch.update({
      where: { id: batchId },
      data: { status: 'PROCESSING', startedAt: new Date(), failureMessage: null },
    });
  },

  async persistFailed(input) {
    await database.$transaction(async (transaction) => {
      await transaction.uploadRow.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadError.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadRow.createMany({ data: rawRows(input) });
      await transaction.uploadError.createMany({
        data: issueRows(input.batchId, [...input.errors, ...input.warnings]),
      });
      await transaction.uploadBatch.update({
        where: { id: input.batchId },
        data: {
          status: 'FAILED',
          totalRows: input.totalRows,
          acceptedRows: 0,
          errorCount: input.errors.length,
          warningCount: input.warnings.length,
          failureStage: 'VALIDATION',
          failureMessage: '数据校验未通过',
          finishedAt: new Date(),
        },
      });
    });
  },

  async persistSuccessful(input) {
    await database.$transaction(async (transaction) => {
      await transaction.uploadRow.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadError.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadRow.createMany({ data: rawRows(input) });
      if (input.warnings.length > 0) {
        await transaction.uploadError.createMany({
          data: issueRows(input.batchId, input.warnings),
        });
      }

      const plan = buildBulkImportPlan(input.records);
      const writer = {
        async executeRaw(query: Prisma.Sql): Promise<void> {
          await transaction.$executeRaw(query);
        },
      };
      await upsertOrganizations(writer, plan.organizations);
      await upsertMerchants(writer, plan.merchants);
      await upsertProjects(writer, plan.projects);

      const dataDate = dateOnly(input.dataDate);
      await transaction.projectSnapshot.deleteMany({
        where: {
          dataDate,
          projectId: { in: plan.projectSnapshots.map((snapshot) => snapshot.projectId) },
        },
      });
      await transaction.projectSnapshot.createMany({
        data: plan.projectSnapshots.map((snapshot) => ({
          dataDate,
          projectId: snapshot.projectId,
          sourceProjectId: snapshot.sourceProjectId,
          merchantId: snapshot.merchantId,
          organizationId: snapshot.organizationId,
          uploadBatchId: input.batchId,
          businessSource: snapshot.businessSource,
          assignedAt: dateOnly(snapshot.assignedAt),
          followWithin30m: snapshot.followWithin30m,
          needsAnalyzed: snapshot.needsAnalyzed,
          hardInvite: snapshot.hardInvite,
          sopCompliant:
            snapshot.followWithin30m === true &&
            snapshot.needsAnalyzed === true &&
            snapshot.hardInvite === false,
          needsCoaching: snapshot.needsCoaching,
          coached: snapshot.coached,
          improved: snapshot.improved,
          raw: json(snapshot.raw),
        })),
      });
      await transaction.job.createMany({
        data: ['METRICS', 'RULES'].map((type) => ({
          type: type as 'METRICS' | 'RULES',
          status: 'QUEUED' as const,
          sourceBatchId: input.batchId,
          payload: { batchId: input.batchId, dataDate: input.dataDate },
        })),
        skipDuplicates: true,
      });
      await transaction.uploadBatch.update({
        where: { id: input.batchId },
        data: {
          status: 'SUCCEEDED',
          totalRows: input.totalRows,
          acceptedRows: input.records.length,
          errorCount: 0,
          warningCount: input.warnings.length,
          failureStage: null,
          failureMessage: null,
          finishedAt: new Date(),
        },
      });
    }, { timeout: 120_000 });
  },
  };
}

export const prismaImportRepository = createPrismaImportRepository(db);

