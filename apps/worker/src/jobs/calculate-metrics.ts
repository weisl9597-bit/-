import { db } from '@designbao/db/client';
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

export const prismaMetricSnapshotRepository: MetricSnapshotRepository = {
  async loadRows({ dataDate, batchId }): Promise<MetricRow[]> {
    const snapshots = await db.projectSnapshot.findMany({
      where: { uploadBatchId: batchId, dataDate: dateOnly(dataDate) },
      include: {
        project: { select: { assignedAt: true } },
        organization: {
          select: { id: true, parent: { select: { id: true, parent: { select: { id: true } } } } },
        },
      },
    });
    return snapshots.map((snapshot) => ({
      assignmentId: snapshot.projectId,
      sourceProjectId: snapshot.sourceProjectId,
      organizationIds: [
        snapshot.organization.parent?.parent?.id,
        snapshot.organization.parent?.id,
        snapshot.organization.id,
      ].filter((id): id is string => Boolean(id)),
      merchantId: snapshot.merchantId,
      dataDate: snapshot.project.assignedAt.toISOString().slice(0, 10),
      followWithin30m: snapshot.followWithin30m,
      needsAnalyzed: snapshot.needsAnalyzed,
      hardInvite: snapshot.hardInvite,
      needsCoaching: snapshot.needsCoaching,
      coached: snapshot.coached,
      improved: snapshot.improved,
      raw: rawRecord(snapshot.raw),
    }));
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
