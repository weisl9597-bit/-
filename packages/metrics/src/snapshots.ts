import type { ActualBusinessSource } from '@designbao/domain/business-source';
import { allMetricDefinitions, type MetricDefinition } from './catalog';
import { calculateMetric, type MetricRow } from './calculate';

export type MetricSnapshotInput = {
  metricId: string;
  businessSource: ActualBusinessSource;
  grain: 'DAY';
  periodStart: string;
  periodEnd: string;
  organizationId: string;
  merchantId: string | null;
  dimensionKey: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  source: 'CALCULATED';
  sourceBatchId: string;
  formulaVersion: string;
};

export type MetricSnapshotRepository = {
  loadRows(input: { dataDate: string; batchId: string }): Promise<MetricRow[]>;
  syncDefinitions(definitions: readonly MetricDefinition[]): Promise<void>;
  deleteSnapshots(batchId: string): Promise<void>;
  insertSnapshots(snapshots: MetricSnapshotInput[]): Promise<number>;
};

const snapshotBatchSize = 500;

function addScope(
  groups: Map<string, MetricRow[]>,
  key: string,
  row: MetricRow,
): void {
  const values = groups.get(key) ?? [];
  values.push(row);
  groups.set(key, values);
}

export async function buildMetricSnapshots(
  dataDate: string,
  batchId: string,
  repository: MetricSnapshotRepository,
): Promise<number> {
  const rows = await repository.loadRows({ dataDate, batchId });
  await repository.syncDefinitions(allMetricDefinitions);
  await repository.deleteSnapshots(batchId);
  const groups = new Map<string, MetricRow[]>();

  for (const row of rows) {
    const source = row.businessSource;
    for (const organizationId of row.organizationIds) {
      addScope(groups, `${source}|organization:${organizationId}`, row);
    }
    const cityId = row.organizationIds.at(-1);
    if (cityId && row.merchantId) addScope(groups, `${source}|merchant:${cityId}:${row.merchantId}`, row);
  }

  let snapshots: MetricSnapshotInput[] = [];
  let snapshotCount = 0;
  const flushSnapshots = async (): Promise<void> => {
    if (snapshots.length === 0) return;
    snapshotCount += await repository.insertSnapshots(snapshots);
    snapshots = [];
  };
  for (const [key, scopedRows] of groups) {
    const [businessSource = 'OTHER', scopeKey = ''] = key.split('|') as [ActualBusinessSource, string];
    const [scope, organizationId = '', merchantId] = scopeKey.split(':');
    const periods = new Set<string>();
    for (const row of scopedRows) {
      for (const period of [
        row.projectDate === undefined ? row.dataDate : row.projectDate,
        row.assignmentDate === undefined ? row.dataDate : row.assignmentDate,
        row.signedDate,
      ]) {
        if (period) periods.add(period);
      }
    }
    for (const period of periods) {
      for (const definition of allMetricDefinitions) {
        const result = calculateMetric(definition, scopedRows, period);
        snapshots.push({
          metricId: definition.id,
          businessSource,
          grain: 'DAY',
          periodStart: period,
          periodEnd: period,
          organizationId,
          merchantId: scope === 'merchant' ? merchantId ?? null : null,
          dimensionKey: scope === 'merchant' ? `merchant:${merchantId}` : 'organization',
          ...result,
          source: 'CALCULATED',
          sourceBatchId: batchId,
          formulaVersion: definition.formulaVersion,
        });
        if (snapshots.length >= snapshotBatchSize) await flushSnapshots();
      }
    }
  }

  await flushSnapshots();
  return snapshotCount;
}

