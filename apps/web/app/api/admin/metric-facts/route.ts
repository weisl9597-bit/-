import { db } from '@designbao/db/client';
import { metricCatalog } from '@designbao/metrics/catalog';
import { buildMetricRowsFromUpload, calculateMetric } from '@designbao/metrics/calculate';
import { authenticateRequest } from '../../../../lib/auth/request-actor';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function countBy(values: readonly unknown[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    const key = String(value ?? '<empty>');
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

export async function GET(request: Request) {
  const actor = await authenticateRequest(request);
  if (!actor) return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  if (actor.role !== 'ADMIN') return Response.json({ error: 'FORBIDDEN' }, { status: 403 });

  const latestBatch = await db.uploadBatch.findFirst({
    where: { status: 'SUCCEEDED' },
    select: { id: true, dataDate: true, totalRows: true, acceptedRows: true },
    orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
  });
  if (!latestBatch) return Response.json({ latestBatch: null });

  const [uploadRows, organizations, merchants] = await Promise.all([
    db.uploadRow.findMany({
      where: { batchId: latestBatch.id, sourceSheet: '项目明细2' },
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

  const rawRecords = uploadRows.map((row) => record(row.raw));
  const canonicalRecords = uploadRows.map((row) => record(row.canonical));
  const metricRows = buildMetricRowsFromUpload({
    dataDate: latestBatch.dataDate.toISOString().slice(0, 10),
    uploadRows,
    organizations,
    merchantIds: merchants.map(({ id }) => id),
  });
  const designbaoRows = metricRows.filter((row) => row.businessSource === 'DESIGNBAO');
  const augustDates = Array.from({ length: 24 }, (_, index) =>
    `2026-08-${String(index + 1).padStart(2, '0')}`,
  );
  const metricValues = metricCatalog.slice(0, 4).map((definition) => ({
    metricId: definition.id,
    value: augustDates.reduce(
      (sum, date) => sum + (calculateMetric(definition, designbaoRows, date).value ?? 0),
      0,
    ),
  }));

  return Response.json({
    latestBatch: {
      dataDate: latestBatch.dataDate.toISOString().slice(0, 10),
      totalRows: latestBatch.totalRows,
      acceptedRows: latestBatch.acceptedRows,
    },
    storedRows: uploadRows.length,
    canonicalRows: canonicalRecords.filter((row) => Object.keys(row).length > 0).length,
    rawShape: {
      firstKeys: Object.keys(rawRecords[0] ?? {}).slice(0, 20),
      nestedRawRows: rawRecords.filter((row) => Object.keys(record(row.raw)).length > 0).length,
    },
    canonicalSources: countBy(canonicalRecords.map((row) => row.businessSource)),
    rawSources: countBy(rawRecords.map((row) => row.F)),
    fieldPresence: Object.fromEntries(['H', 'I', 'J', 'T', 'U'].map((field) => [
      field,
      rawRecords.filter((row) => row[field] !== null && row[field] !== undefined && row[field] !== '').length,
    ])),
    fieldTypes: Object.fromEntries(['H', 'I', 'J', 'T', 'U'].map((field) => [
      field,
      countBy(rawRecords.map((row) => typeof row[field])),
    ])),
    reconstructed: {
      total: metricRows.length,
      bySource: countBy(metricRows.map((row) => row.businessSource)),
      designbaoDateRange: {
        min: designbaoRows.map((row) => row.projectDate).filter(Boolean).sort()[0] ?? null,
        max: designbaoRows.map((row) => row.projectDate).filter(Boolean).sort().at(-1) ?? null,
      },
      metricValues,
    },
  });
}

