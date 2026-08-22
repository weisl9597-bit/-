import { createHash } from 'node:crypto';
import { db } from '@designbao/db/client';
import { Prisma } from '@prisma/client';
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

function organizationId(level: 'national' | 'region' | 'city', path: string): string {
  return `org_${level}_${createHash('sha256').update(path).digest('hex').slice(0, 20)}`;
}

export function buildOrganizationPaths(region: string, city: string) {
  const nationalPath = '/china';
  const regionPath = `${nationalPath}/${encodeURIComponent(region)}`;
  return {
    nationalPath,
    regionPath,
    cityPath: `${regionPath}/${encodeURIComponent(city)}`,
  };
}

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

export const prismaImportRepository: ImportBatchRepository = {
  async getBatch(batchId): Promise<ImportBatchRecord | null> {
    const batch = await db.uploadBatch.findUnique({ where: { id: batchId } });
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
    await db.uploadBatch.update({
      where: { id: batchId },
      data: { status: 'PROCESSING', startedAt: new Date(), failureMessage: null },
    });
  },

  async persistFailed(input) {
    await db.$transaction(async (transaction) => {
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
    await db.$transaction(async (transaction) => {
      await transaction.uploadRow.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadError.deleteMany({ where: { batchId: input.batchId } });
      await transaction.uploadRow.createMany({ data: rawRows(input) });
      if (input.warnings.length > 0) {
        await transaction.uploadError.createMany({
          data: issueRows(input.batchId, input.warnings),
        });
      }

      const cityIds = new Map<string, string>();
      const nationalPath = '/china';
      const nationalId = organizationId('national', nationalPath);
      await transaction.organization.upsert({
        where: { path: nationalPath },
        create: { id: nationalId, code: 'CN', name: '全国', level: 'NATIONAL', path: nationalPath },
        update: { code: 'CN', name: '全国', level: 'NATIONAL' },
      });
      for (const record of input.records) {
        const { regionPath, cityPath } = buildOrganizationPaths(record.region, record.city);
        const regionId = organizationId('region', regionPath);
        await transaction.organization.upsert({
          where: { path: regionPath },
          create: {
            id: regionId,
            name: record.region,
            level: 'REGION',
            path: regionPath,
            parentId: nationalId,
          },
          update: { name: record.region, parentId: nationalId },
        });
        const cityId = organizationId('city', cityPath);
        await transaction.organization.upsert({
          where: { path: cityPath },
          create: {
            id: cityId,
            name: record.city,
            level: 'CITY',
            path: cityPath,
            parentId: regionId,
          },
          update: { name: record.city, parentId: regionId },
        });
        cityIds.set(record.city, cityId);
      }

      for (const record of input.records) {
        const cityId = cityIds.get(record.city)!;
        await transaction.merchant.upsert({
          where: { id: record.merchantId },
          create: {
            id: record.merchantId,
            name: record.merchantName ?? record.merchantId,
            organizationId: cityId,
          },
          update: {
            name: record.merchantName ?? record.merchantId,
            organizationId: cityId,
          },
        });
        await transaction.project.upsert({
          where: { id: record.assignmentId },
          create: {
            id: record.assignmentId,
            sourceProjectId: record.projectId,
            merchantId: record.merchantId,
            organizationId: cityId,
            assignedAt: dateOnly(record.assignedAt),
            followWithin30m: record.followWithin30m,
            needsAnalyzed: record.needsAnalyzed,
            hardInvite: record.hardInvite,
            needsCoaching: record.needsCoaching,
            coached: record.coached,
            improved: record.improved,
          },
          update: {
            sourceProjectId: record.projectId,
            merchantId: record.merchantId,
            organizationId: cityId,
            assignedAt: dateOnly(record.assignedAt),
            followWithin30m: record.followWithin30m,
            needsAnalyzed: record.needsAnalyzed,
            hardInvite: record.hardInvite,
            needsCoaching: record.needsCoaching,
            coached: record.coached,
            improved: record.improved,
          },
        });
      }

      await transaction.projectSnapshot.createMany({
        data: input.records.map((record) => ({
          dataDate: dateOnly(input.dataDate),
          projectId: record.assignmentId,
          sourceProjectId: record.projectId,
          merchantId: record.merchantId,
          organizationId: cityIds.get(record.city)!,
          uploadBatchId: input.batchId,
          followWithin30m: record.followWithin30m,
          needsAnalyzed: record.needsAnalyzed,
          hardInvite: record.hardInvite,
          sopCompliant:
            record.followWithin30m === true &&
            record.needsAnalyzed === true &&
            record.hardInvite === false,
          needsCoaching: record.needsCoaching,
          coached: record.coached,
          improved: record.improved,
          raw: json(record.raw),
        })),
        skipDuplicates: true,
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
