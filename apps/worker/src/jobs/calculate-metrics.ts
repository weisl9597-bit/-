import { db } from '@designbao/db/client';
import { buildMetricRowsFromUpload, type MetricRow } from '@designbao/metrics/calculate';
import type { MetricDefinition } from '@designbao/metrics/catalog';
import {
  buildMetricSnapshots,
  type MetricSnapshotInput,
  type MetricSnapshotRepository,
} from '@designbao/metrics/snapshots';

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
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
    return buildMetricRowsFromUpload({
      dataDate,
      uploadRows,
      organizations,
      merchantIds: merchants.map(({ id }) => id),
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
  sourceAwareEnabled?: boolean;
}): Promise<{ snapshotCount: number }> {
  const snapshotCount = await buildMetricSnapshots(
    input.dataDate,
    input.batchId,
    input.repository ?? prismaMetricSnapshotRepository,
    { sourceAware: input.sourceAwareEnabled ?? process.env.SOURCE_AWARE_OPERATIONS_ENABLED === 'true' },
  );
  return { snapshotCount };
}

