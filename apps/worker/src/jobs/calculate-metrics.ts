import { db } from '@designbao/db/client';
import { normalizeBusinessSource } from '@designbao/domain/business-source';
import type { MetricRow } from '@designbao/metrics/calculate';
import type { MetricDefinition } from '@designbao/metrics/catalog';
import {
  buildMetricSnapshots,
  type MetricSnapshotInput,
  type MetricSnapshotRepository,
} from '@designbao/metrics/snapshots';
import type { Prisma } from '@prisma/client';

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function rawRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function workbookDate(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86_400_000))
      .toISOString().slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(value.trim());
  if (match?.[1] && match[2] && match[3]) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function assignmentCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function yes(value: unknown): boolean | null {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (['是', '有', '已完成', '完成', '1', 'true'].includes(normalized)) return true;
  if (['否', '无', '未完成', '0', 'false'].includes(normalized)) return false;
  return null;
}

export const prismaMetricSnapshotRepository: MetricSnapshotRepository = {
  async loadRows({ dataDate, batchId }): Promise<MetricRow[]> {
    const [uploadRows, organizations, merchants] = await Promise.all([
      db.uploadRow.findMany({
        where: { batchId, sourceSheet: '项目明细2' },
        select: { id: true, sourceRow: true, raw: true, canonical: true },
        orderBy: { sourceRow: 'asc' },
      }),
      db.organization.findMany({
        select: {
          id: true,
          name: true,
          level: true,
          parent: { select: { id: true, parent: { select: { id: true } } } },
        },
      }),
      db.merchant.findMany({ select: { id: true } }),
    ]);
    const nationalId = organizations.find(({ level }) => level === 'NATIONAL')?.id;
    const cityByName = new Map(organizations
      .filter(({ level }) => level === 'CITY')
      .map((organization) => [organization.name.trim(), organization]));
    const merchantIds = new Set(merchants.map(({ id }) => id));

    return uploadRows.flatMap((uploadRow): MetricRow[] => {
      const raw = rawRecord(uploadRow.raw);
      const canonical = rawRecord(uploadRow.canonical ?? {});
      const projectDate = workbookDate(raw.H)
        ?? workbookDate(canonical.assignedAt)
        ?? dataDate;
      const city = cityByName.get(text(canonical.city || raw.A));
      const organizationIds = [
        city?.parent?.parent?.id ?? nationalId,
        city?.parent?.id,
        city?.id,
      ].filter((id): id is string => Boolean(id));
      if (organizationIds.length === 0) return [];
      const rawMerchantId = text(canonical.merchantId || raw.B);
      const merchantId = merchantIds.has(rawMerchantId) ? rawMerchantId : '';
      const sourceProjectId = text(canonical.projectId || raw.D) || `row:${uploadRow.sourceRow}`;
      return [{
        rowId: uploadRow.id,
        assignmentId: text(canonical.assignmentId) || `${sourceProjectId}::${merchantId || `row:${uploadRow.sourceRow}`}`,
        sourceProjectId,
        organizationIds,
        merchantId,
        dataDate: projectDate,
        projectDate,
        assignmentDate: workbookDate(raw.I) ?? projectDate,
        signedDate: workbookDate(raw.AL),
        assignmentCount: assignmentCount(raw.J),
        businessSource: normalizeBusinessSource(canonical.businessSource ?? raw.F),
        followWithin30m: typeof canonical.followWithin30m === 'boolean'
          ? canonical.followWithin30m : yes(raw.N),
        needsAnalyzed: typeof canonical.needsAnalyzed === 'boolean'
          ? canonical.needsAnalyzed : yes(raw.O),
        hardInvite: typeof canonical.hardInvite === 'boolean'
          ? canonical.hardInvite : yes(raw.P),
        needsCoaching: typeof canonical.needsCoaching === 'boolean' ? canonical.needsCoaching : null,
        coached: typeof canonical.coached === 'boolean' ? canonical.coached : null,
        improved: typeof canonical.improved === 'boolean' ? canonical.improved : null,
        raw,
      }];
    });
  },

  async syncDefinitions(definitions: readonly MetricDefinition[]) {
    await db.$transaction(definitions.map((definition) => db.metricDefinition.upsert({
      where: { id: definition.id },
      create: definition,
      update: {
        name: definition.name,
        groupId: definition.groupId,
        groupName: definition.groupName,
        unit: definition.unit,
        direction: definition.direction,
        source: definition.source,
        sortOrder: definition.sortOrder,
        formulaVersion: definition.formulaVersion,
        enabled: true,
      },
    })));
  },

  async deleteSnapshots(batchId) {
    await db.metricSnapshot.deleteMany({ where: { sourceBatchId: batchId } });
  },

  async insertSnapshots(snapshots: MetricSnapshotInput[]) {
    const result = await db.metricSnapshot.createMany({
      data: snapshots.map((snapshot) => ({
        ...snapshot,
        periodStart: dateOnly(snapshot.periodStart),
        periodEnd: dateOnly(snapshot.periodEnd),
      })),
      skipDuplicates: true,
    });
    return result.count;
  },
};

export async function runCalculateMetricsJob(input: {
  batchId: string;
  dataDate: string;
  repository?: MetricSnapshotRepository;
}): Promise<{ snapshotCount: number }> {
  const snapshotCount = await buildMetricSnapshots(
    input.dataDate,
    input.batchId,
    input.repository ?? prismaMetricSnapshotRepository,
  );
  return { snapshotCount };
}

