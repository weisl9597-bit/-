import { allMetricDefinitions, type MetricDefinition } from './catalog';
import { calculateMetric, type MetricRow } from './calculate';

export type MetricSnapshotInput = {
  metricId: string;
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
  insertSnapshots(snapshots: MetricSnapshotInput[]): Promise<number>;
};

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
  const groups = new Map<string, MetricRow[]>();

  for (const row of rows) {
    for (const organizationId of row.organizationIds) {
      addScope(groups, `${row.dataDate}|organization:${organizationId}`, row);
    }
    const cityId = row.organizationIds.at(-1);
    if (cityId) addScope(groups, `${row.dataDate}|merchant:${cityId}:${row.merchantId}`, row);
  }

  const snapshots: MetricSnapshotInput[] = [];
  for (const [key, scopedRows] of groups) {
    const [period = dataDate, scopeKey = ''] = key.split('|');
    const [scope, organizationId = '', merchantId] = scopeKey.split(':');
    for (const definition of allMetricDefinitions) {
      const result = calculateMetric(definition, scopedRows);
      snapshots.push({
        metricId: definition.id,
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
    }
  }

  return repository.insertSnapshots(snapshots);
}
