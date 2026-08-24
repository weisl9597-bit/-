import { db } from '@designbao/db/client';
import type { ActualBusinessSource, SelectableBusinessSource } from '@designbao/domain/business-source';
import { getPeriodBounds } from '@designbao/domain/period';
import {
  evaluateRules,
  type RuleEvaluationRepository,
} from '@designbao/rules/evaluate';
import type { MerchantClassificationInput } from '@designbao/rules/merchant-classification';
import type { ClassificationDecision } from '@designbao/rules/merchant-classification';
import type { Prisma } from '@prisma/client';

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function dateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function number(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

type DailyMetric = {
  metricId: string;
  businessSource: ActualBusinessSource | 'ALL';
  merchantId: string | null;
  organizationId: string;
  periodStart: Date;
  numerator: Prisma.Decimal | null;
  denominator: Prisma.Decimal | null;
  value: Prisma.Decimal | null;
};

type SourceScopedOverride = {
  type: 'CONFIRM_C' | 'TEMP_EXEMPT' | 'PERMANENT_EXCLUDE' | 'MANUAL_CLASSIFICATION';
  businessSource: SelectableBusinessSource | ActualBusinessSource | null;
  classification?: MerchantClassificationInput['currentClassification'];
  startDate?: Date;
  endDate: Date | null;
};

export type HistoricalAssignment = {
  batchId: string;
  projectId: string;
  merchantId: string;
  businessSource: ActualBusinessSource;
  dataDate: Date;
  assignedAt: Date;
  batchStatus: string;
  batchCreatedAt: Date;
};

export type HistoricalUploadBatch = {
  batchId: string;
  dataDate: Date;
  batchStatus: string;
  batchCreatedAt: Date;
};

export function latestHistoricalBatchIds(
  batches: readonly HistoricalUploadBatch[],
  asOf: Date,
): string[] {
  const latestBatchByDate = new Map<string, string>();
  const eligibleBatches = batches
    .filter((batch) => batch.batchStatus === 'SUCCEEDED' && batch.dataDate <= asOf)
    .sort((left, right) => (
      right.batchCreatedAt.getTime() - left.batchCreatedAt.getTime()
      || right.batchId.localeCompare(left.batchId)
    ));

  for (const batch of eligibleBatches) {
    const date = dateString(batch.dataDate);
    if (!latestBatchByDate.has(date)) latestBatchByDate.set(date, batch.batchId);
  }

  return [...latestBatchByDate.values()];
}

export function selectHistoricalAssignments(
  rows: readonly HistoricalAssignment[],
  asOf: Date,
  batches: readonly HistoricalUploadBatch[] = rows.map((row) => ({
    batchId: row.batchId,
    dataDate: row.dataDate,
    batchStatus: row.batchStatus,
    batchCreatedAt: row.batchCreatedAt,
  })),
): HistoricalAssignment[] {
  const nextDay = new Date(asOf);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const selectedBatchIds = new Set(latestHistoricalBatchIds(batches, asOf));
  return rows.filter((row) => (
    row.batchStatus === 'SUCCEEDED'
    && row.dataDate <= asOf
    && row.assignedAt < nextDay
    && selectedBatchIds.has(row.batchId)
  ));
}

export function sourceScopedOverrideState(
  overrides: readonly SourceScopedOverride[],
  businessSource: SelectableBusinessSource,
) {
  const scoped = overrides.filter((override) => (
    override.businessSource === businessSource
    || (override.type === 'PERMANENT_EXCLUDE' && override.businessSource === null)
  ));
  const temporary = scoped
    .filter((override) => override.type === 'TEMP_EXEMPT' && override.endDate)
    .sort((left, right) => right.endDate!.getTime() - left.endDate!.getTime())[0];
  const manual = scoped
    .filter((override) => override.type === 'MANUAL_CLASSIFICATION' && override.classification)
    .sort((left, right) => (right.startDate?.getTime() ?? 0) - (left.startDate?.getTime() ?? 0))[0];
  return {
    cConfirmed: scoped.some((override) => override.type === 'CONFIRM_C'),
    temporaryExemptUntil: temporary?.endDate ? dateString(temporary.endDate) : null,
    permanentlyExcluded: scoped.some((override) => (
      override.type === 'PERMANENT_EXCLUDE' && override.businessSource === null
    )),
    manualClassification: manual?.classification ?? null,
    manualClassificationSince: manual?.startDate ? dateString(manual.startDate) : null,
  };
}

export function decisionsForRollout(
  decisions: readonly ClassificationDecision[],
  sourceAwareEnabled: boolean,
): ClassificationDecision[] {
  return sourceAwareEnabled
    ? [...decisions]
    : decisions.filter((decision) => decision.businessSource === 'ALL');
}

function aggregateRate(rows: DailyMetric[]): number | null {
  const denominator = rows.reduce((sum, row) => sum + (number(row.denominator) ?? 0), 0);
  const numerator = rows.reduce((sum, row) => sum + (number(row.numerator) ?? 0), 0);
  return denominator === 0 ? null : Math.round((numerator / denominator) * 1_000_000) / 10_000;
}

function weeklyRates(rows: DailyMetric[]): number[] {
  const weeks = new Map<string, DailyMetric[]>();
  for (const row of rows) {
    const start = getPeriodBounds(row.periodStart, 'WEEK').start.toISOString();
    const values = weeks.get(start) ?? [];
    values.push(row);
    weeks.set(start, values);
  }
  return [...weeks]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, values]) => aggregateRate(values))
    .filter((value): value is number => value !== null);
}

export const prismaRuleEvaluationRepository: RuleEvaluationRepository = {
  async loadProjectFacts({ batchId }) {
    const snapshots = await db.projectSnapshot.findMany({
      where: { uploadBatchId: batchId },
      select: {
        projectId: true, merchantId: true, businessSource: true,
        needsCoaching: true, coached: true, improved: true,
      },
    });
    return snapshots.flatMap((snapshot) => snapshot.businessSource === 'ALL'
      ? []
      : [{ ...snapshot, businessSource: snapshot.businessSource as ActualBusinessSource }]);
  },

  async loadMerchantInputs({ dataDate, batchId }): Promise<MerchantClassificationInput[]> {
    const batchProjects = await db.projectSnapshot.findMany({
      where: { uploadBatchId: batchId },
      select: { merchantId: true, organizationId: true, businessSource: true, assignedAt: true },
    });
    const merchantIds = [...new Set(batchProjects.map((row) => row.merchantId))];
    if (merchantIds.length === 0) return [];
    const cityByMerchant = new Map(batchProjects.map((row) => [row.merchantId, row.organizationId]));
    const currentDate = dateOnly(dataDate);
    const lookback = new Date(currentDate);
    lookback.setUTCDate(lookback.getUTCDate() - 27);
    const monthStart = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));
    const nextDate = new Date(currentDate);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);

    const [metrics, classifications, overrides, historicalBatches] = await Promise.all([
      db.metricSnapshot.findMany({
        where: {
          sourceBatchId: batchId,
          grain: 'DAY',
          periodStart: { gte: lookback, lte: currentDate },
          metricId: { in: ['merchant_sop_compliance_rate', 'project_open_rate', 'signed_project_count'] },
          OR: [{ merchantId: { in: merchantIds } }, { merchantId: null }],
        },
        select: {
          metricId: true, merchantId: true, organizationId: true, periodStart: true,
          businessSource: true, numerator: true, denominator: true, value: true,
        },
      }),
      db.merchantClassificationSnapshot.findMany({
        where: { merchantId: { in: merchantIds }, dataDate: { lte: currentDate } },
        orderBy: [{ merchantId: 'asc' }, { dataDate: 'desc' }],
      }),
      db.merchantOverride.findMany({
        where: {
          merchantId: { in: merchantIds }, startDate: { lte: currentDate },
          OR: [{ endDate: null }, { endDate: { gte: currentDate } }],
        },
      }),
      db.uploadBatch.findMany({
        where: {
          dataDate: { lte: currentDate },
          status: 'SUCCEEDED',
        },
        select: {
          id: true, dataDate: true, status: true, createdAt: true,
        },
      }),
    ]);
    const batchFacts: HistoricalUploadBatch[] = historicalBatches.map((batch) => ({
      batchId: batch.id,
      dataDate: batch.dataDate,
      batchStatus: batch.status,
      batchCreatedAt: batch.createdAt,
    }));
    const selectedBatchIds = latestHistoricalBatchIds(batchFacts, currentDate);
    const lastAssignmentRows = selectedBatchIds.length === 0 ? [] : await db.projectSnapshot.findMany({
      where: {
        uploadBatchId: { in: selectedBatchIds },
        merchantId: { in: merchantIds },
        businessSource: { in: ['DESIGNBAO', 'XIAOHONGSHU'] },
        assignedAt: { lt: nextDate },
      },
      select: {
        projectId: true, merchantId: true, businessSource: true,
        dataDate: true, assignedAt: true,
        uploadBatch: { select: { id: true, status: true, createdAt: true } },
      },
    });
    const lastAssignments = selectHistoricalAssignments(lastAssignmentRows.flatMap((row) => (
      row.businessSource === 'DESIGNBAO' || row.businessSource === 'XIAOHONGSHU'
        ? [{
          batchId: row.uploadBatch.id,
          projectId: row.projectId,
          merchantId: row.merchantId,
          businessSource: row.businessSource,
          dataDate: row.dataDate,
          assignedAt: row.assignedAt,
          batchStatus: row.uploadBatch.status,
          batchCreatedAt: row.uploadBatch.createdAt,
        }]
        : []
    )), currentDate, batchFacts);

    const latestClassification = new Map<string, (typeof classifications)[number]>();
    for (const classification of classifications) {
      const key = `${classification.merchantId}|${classification.businessSource}`;
      if (!latestClassification.has(key)) {
        latestClassification.set(key, classification);
      }
    }
    const overridesByMerchant = new Map<string, typeof overrides>();
    for (const override of overrides) {
      const values = overridesByMerchant.get(override.merchantId) ?? [];
      values.push(override);
      overridesByMerchant.set(override.merchantId, values);
    }
    const sources = ['DESIGNBAO', 'XIAOHONGSHU', 'ALL'] as const;
    const actualSources = (businessSource: SelectableBusinessSource): ActualBusinessSource[] => (
      businessSource === 'ALL' ? ['DESIGNBAO', 'XIAOHONGSHU'] : [businessSource]
    );

    return merchantIds.flatMap((merchantId) => sources.map((businessSource) => {
      const cityId = cityByMerchant.get(merchantId)!;
      const includedSources = actualSources(businessSource);
      const merchantMetrics = metrics.filter((row) => (
        row.merchantId === merchantId && includedSources.includes(row.businessSource as ActualBusinessSource)
      ));
      const sopRows = merchantMetrics.filter((row) => row.metricId === 'merchant_sop_compliance_rate');
      const recentStart = new Date(currentDate);
      recentStart.setUTCDate(recentStart.getUTCDate() - 13);
      const recentSop = sopRows.filter((row) => row.periodStart >= recentStart);
      const processRows = merchantMetrics.filter((row) =>
        row.metricId === 'project_open_rate' && row.periodStart >= recentStart,
      );
      const cityRows = metrics.filter((row) =>
        row.merchantId === null && row.organizationId === cityId
        && includedSources.includes(row.businessSource as ActualBusinessSource)
        && row.metricId === 'project_open_rate' && row.periodStart >= recentStart,
      );
      const signedThisMonth = merchantMetrics.some((row) =>
        row.metricId === 'signed_project_count' && row.periodStart >= monthStart
        && (number(row.value) ?? 0) > 0,
      );
      const current = latestClassification.get(`${merchantId}|${businessSource}`);
      const activeOverrides = overridesByMerchant.get(merchantId) ?? [];
      const overrideState = sourceScopedOverrideState(activeOverrides, businessSource);
      const assignedAt = lastAssignments
        .filter((row) => row.merchantId === merchantId
          && includedSources.includes(row.businessSource as ActualBusinessSource))
        .reduce<Date | null>((latest, row) => (
          latest === null || row.assignedAt > latest ? row.assignedAt : latest
        ), null);
      const dataAvailable = batchProjects.some((row) => row.merchantId === merchantId
        && includedSources.includes(row.businessSource as ActualBusinessSource));
      return {
        merchantId,
        businessSource,
        dataAvailable,
        dataDate,
        sopRate: aggregateRate(recentSop),
        signedThisMonth,
        weeklySopRates: weeklyRates(sopRows),
        processMetric: aggregateRate(processRows),
        cityProcessAverage: aggregateRate(cityRows),
        currentClassification: current?.classification ?? null,
        manualClassification: overrideState.manualClassification,
        classificationSince: overrideState.manualClassificationSince
          ?? (current ? dateString(current.effectiveAt) : null),
        lastAssignedAt: assignedAt ? dateString(assignedAt) : null,
        cConfirmed: overrideState.cConfirmed,
        temporaryExemptUntil: overrideState.temporaryExemptUntil,
        permanentlyExcluded: overrideState.permanentlyExcluded,
      };
    }));
  },

  async persist({ dataDate, batchId, hits, decisions }) {
    await db.$transaction(async (transaction) => {
      await transaction.ruleHit.deleteMany({ where: { sourceBatchId: batchId, version: 'v2' } });
      if (hits.length > 0) {
        await transaction.ruleHit.createMany({
          data: hits.map((hit) => ({
            code: hit.code,
            version: hit.ruleVersion,
            entityType: 'PROJECT' as const,
            entityId: hit.projectId,
            projectId: hit.projectId,
            merchantId: hit.merchantId,
            businessSource: hit.businessSource,
            dataDate: dateOnly(dataDate),
            evidence: json(hit.evidence),
            reason: hit.reason,
            sourceBatchId: batchId,
          })),
          skipDuplicates: true,
        });
      }
      for (const item of decisions) {
        const row = {
            merchantId: item.merchantId,
            dataDate: dateOnly(dataDate),
            businessSource: item.businessSource,
            dataAvailable: item.dataAvailable,
            classification: item.dataAvailable ? item.suggested : null,
            suggested: item.suggested,
            reason: item.reason,
            evidence: json(item.evidence),
            ruleVersion: item.ruleVersion,
            requiresConfirmation: item.requiresConfirmation,
            effectiveAt: dateOnly(dataDate),
        };
        const where = {
          merchantId_dataDate_businessSource: {
            merchantId: item.merchantId,
            dataDate: dateOnly(dataDate),
            businessSource: item.businessSource,
          },
        };
        const existing = await transaction.merchantClassificationSnapshot.findUnique({ where });
        await transaction.merchantClassificationSnapshot.upsert({
          where,
          create: row,
          update: existing?.confirmedById && row.dataAvailable ? {
            suggested: row.suggested,
            reason: row.reason,
            evidence: row.evidence,
            ruleVersion: row.ruleVersion,
            dataAvailable: row.dataAvailable,
          } : row,
        });
      }
    });
  },
};

export async function runEvaluateRulesJob(input: {
  batchId: string;
  dataDate: string;
  repository?: RuleEvaluationRepository;
  sourceAwareEnabled?: boolean;
}): Promise<{ projectAlertCount: number; merchantDecisionCount: number }> {
  const repository = input.repository ?? prismaRuleEvaluationRepository;
  const sourceAwareEnabled = input.sourceAwareEnabled
    ?? process.env.SOURCE_AWARE_OPERATIONS_ENABLED === 'true';
  return evaluateRules(
    input.dataDate,
    input.batchId,
    sourceAwareEnabled ? repository : {
      ...repository,
      persist: (payload) => repository.persist({
        ...payload,
        decisions: decisionsForRollout(payload.decisions, false),
      }),
    },
  );
}
