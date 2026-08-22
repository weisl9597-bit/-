import { db } from '@designbao/db/client';
import { getPeriodBounds } from '@designbao/domain/period';
import {
  evaluateRules,
  type RuleEvaluationRepository,
} from '@designbao/rules/evaluate';
import type { MerchantClassificationInput } from '@designbao/rules/merchant-classification';
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
  merchantId: string | null;
  organizationId: string;
  periodStart: Date;
  numerator: Prisma.Decimal | null;
  denominator: Prisma.Decimal | null;
  value: Prisma.Decimal | null;
};

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
        projectId: true, merchantId: true, needsCoaching: true, coached: true, improved: true,
      },
    });
    return snapshots;
  },

  async loadMerchantInputs({ dataDate, batchId }): Promise<MerchantClassificationInput[]> {
    const batchProjects = await db.projectSnapshot.findMany({
      where: { uploadBatchId: batchId },
      select: { merchantId: true, organizationId: true },
      distinct: ['merchantId'],
    });
    const merchantIds = batchProjects.map((row) => row.merchantId);
    if (merchantIds.length === 0) return [];
    const cityByMerchant = new Map(batchProjects.map((row) => [row.merchantId, row.organizationId]));
    const currentDate = dateOnly(dataDate);
    const lookback = new Date(currentDate);
    lookback.setUTCDate(lookback.getUTCDate() - 27);
    const monthStart = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1));

    const [metrics, classifications, overrides, lastAssignments] = await Promise.all([
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
          numerator: true, denominator: true, value: true,
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
      db.project.groupBy({
        by: ['merchantId'], where: { merchantId: { in: merchantIds } },
        _max: { assignedAt: true },
      }),
    ]);

    const latestClassification = new Map<string, (typeof classifications)[number]>();
    for (const classification of classifications) {
      if (!latestClassification.has(classification.merchantId)) {
        latestClassification.set(classification.merchantId, classification);
      }
    }
    const overridesByMerchant = new Map<string, typeof overrides>();
    for (const override of overrides) {
      const values = overridesByMerchant.get(override.merchantId) ?? [];
      values.push(override);
      overridesByMerchant.set(override.merchantId, values);
    }
    const lastByMerchant = new Map(lastAssignments.map((row) => [row.merchantId, row._max.assignedAt]));

    return merchantIds.map((merchantId) => {
      const cityId = cityByMerchant.get(merchantId)!;
      const merchantMetrics = metrics.filter((row) => row.merchantId === merchantId);
      const sopRows = merchantMetrics.filter((row) => row.metricId === 'merchant_sop_compliance_rate');
      const recentStart = new Date(currentDate);
      recentStart.setUTCDate(recentStart.getUTCDate() - 13);
      const recentSop = sopRows.filter((row) => row.periodStart >= recentStart);
      const processRows = merchantMetrics.filter((row) =>
        row.metricId === 'project_open_rate' && row.periodStart >= recentStart,
      );
      const cityRows = metrics.filter((row) =>
        row.merchantId === null && row.organizationId === cityId
        && row.metricId === 'project_open_rate' && row.periodStart >= recentStart,
      );
      const signedThisMonth = merchantMetrics.some((row) =>
        row.metricId === 'signed_project_count' && row.periodStart >= monthStart
        && (number(row.value) ?? 0) > 0,
      );
      const current = latestClassification.get(merchantId);
      const activeOverrides = overridesByMerchant.get(merchantId) ?? [];
      const temporary = activeOverrides
        .filter((override) => override.type === 'TEMP_EXEMPT' && override.endDate)
        .sort((left, right) => right.endDate!.getTime() - left.endDate!.getTime())[0];
      return {
        merchantId,
        dataDate,
        sopRate: aggregateRate(recentSop),
        signedThisMonth,
        weeklySopRates: weeklyRates(sopRows),
        processMetric: aggregateRate(processRows),
        cityProcessAverage: aggregateRate(cityRows),
        currentClassification: current?.classification ?? null,
        classificationSince: current ? dateString(current.effectiveAt) : null,
        lastAssignedAt: lastByMerchant.get(merchantId) ? dateString(lastByMerchant.get(merchantId)!) : null,
        cConfirmed: activeOverrides.some((override) => override.type === 'CONFIRM_C'),
        temporaryExemptUntil: temporary?.endDate ? dateString(temporary.endDate) : null,
        permanentlyExcluded: activeOverrides.some((override) => override.type === 'PERMANENT_EXCLUDE'),
      };
    });
  },

  async persist({ dataDate, batchId, hits, decisions }) {
    await db.$transaction(async (transaction) => {
      if (hits.length > 0) {
        await transaction.ruleHit.createMany({
          data: hits.map((hit) => ({
            code: hit.code,
            version: hit.ruleVersion,
            entityType: 'PROJECT' as const,
            entityId: hit.projectId,
            projectId: hit.projectId,
            merchantId: hit.merchantId,
            dataDate: dateOnly(dataDate),
            evidence: json(hit.evidence),
            reason: hit.reason,
            sourceBatchId: batchId,
          })),
          skipDuplicates: true,
        });
      }
      if (decisions.length > 0) {
        await transaction.merchantClassificationSnapshot.createMany({
          data: decisions.map((item) => ({
            merchantId: item.merchantId,
            dataDate: dateOnly(dataDate),
            classification: item.suggested,
            suggested: item.suggested,
            reason: item.reason,
            evidence: json(item.evidence),
            ruleVersion: item.ruleVersion,
            requiresConfirmation: item.requiresConfirmation,
            effectiveAt: dateOnly(dataDate),
          })),
          skipDuplicates: true,
        });
      }
    });
  },
};

export async function runEvaluateRulesJob(input: {
  batchId: string;
  dataDate: string;
  repository?: RuleEvaluationRepository;
}): Promise<{ projectAlertCount: number; merchantDecisionCount: number }> {
  return evaluateRules(
    input.dataDate,
    input.batchId,
    input.repository ?? prismaRuleEvaluationRepository,
  );
}
