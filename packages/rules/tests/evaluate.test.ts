import { describe, expect, it } from 'vitest';
import { evaluateRules, type RuleEvaluationRepository } from '../src/evaluate';

describe('rule evaluation', () => {
  it('persists project hits and merchant decisions idempotently through the repository', async () => {
    const persisted: { hits: unknown[]; decisions: unknown[] } = { hits: [], decisions: [] };
    const repository: RuleEvaluationRepository = {
      loadProjectFacts: async () => [{
        projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        needsCoaching: true, coached: null, improved: false,
      }],
      loadMerchantInputs: async () => [{
        merchantId: 'M1', businessSource: 'DESIGNBAO', dataAvailable: true,
        dataDate: '2026-08-21', sopRate: 70, signedThisMonth: true,
        weeklySopRates: [70], processMetric: 65, cityProcessAverage: 60,
        currentClassification: 'A', classificationSince: '2026-08-01',
        lastAssignedAt: '2026-08-20', cConfirmed: false,
        temporaryExemptUntil: null, permanentlyExcluded: false,
      }],
      persist: async ({ hits, decisions }) => {
        persisted.hits.push(...hits); persisted.decisions.push(...decisions);
      },
    };

    await expect(evaluateRules('2026-08-21', 'batch-1', repository)).resolves.toEqual({
      projectAlertCount: 3, merchantDecisionCount: 1,
    });
    expect(persisted.hits).toHaveLength(3);
    expect(persisted.decisions).toContainEqual(expect.objectContaining({ suggested: 'A' }));
  });

  it('keeps independent DESIGNBAO, XIAOHONGSHU, and ALL decisions in fixed order', async () => {
    const decisions: unknown[] = [];
    const base = {
      merchantId: 'M1', dataAvailable: true, dataDate: '2026-08-21',
      signedThisMonth: true, weeklySopRates: [70] as number[], processMetric: 65,
      cityProcessAverage: 60, currentClassification: null, classificationSince: null,
      lastAssignedAt: '2026-08-20', cConfirmed: false,
      temporaryExemptUntil: null, permanentlyExcluded: false,
    } as const;
    const repository: RuleEvaluationRepository = {
      loadProjectFacts: async () => [],
      loadMerchantInputs: async () => [
        { ...base, businessSource: 'DESIGNBAO' as const, sopRate: 70 },
        { ...base, businessSource: 'XIAOHONGSHU' as const, sopRate: 50, signedThisMonth: false, weeklySopRates: [58, 54, 50], processMetric: 40 },
        { ...base, businessSource: 'ALL' as const, sopRate: 58, signedThisMonth: false },
        { ...base, merchantId: 'M2', businessSource: 'XIAOHONGSHU' as const, dataAvailable: false, sopRate: null },
      ],
      persist: async (input) => { decisions.push(...input.decisions); },
    };

    await evaluateRules('2026-08-21', 'batch-1', repository);
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ merchantId: 'M1', businessSource: 'DESIGNBAO', suggested: 'A' }),
      expect.objectContaining({ merchantId: 'M1', businessSource: 'XIAOHONGSHU', suggested: 'B' }),
      expect.objectContaining({ merchantId: 'M1', businessSource: 'ALL', suggested: 'A_RISK' }),
      expect.objectContaining({ merchantId: 'M2', businessSource: 'XIAOHONGSHU', dataAvailable: false, suggested: null }),
    ]));
  });
});

