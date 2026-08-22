import { describe, expect, it } from 'vitest';
import { evaluateRules, type RuleEvaluationRepository } from '../src/evaluate';

describe('rule evaluation', () => {
  it('persists project hits and merchant decisions idempotently through the repository', async () => {
    const persisted: { hits: unknown[]; decisions: unknown[] } = { hits: [], decisions: [] };
    const repository: RuleEvaluationRepository = {
      loadProjectFacts: async () => [{
        projectId: 'P1::M1', merchantId: 'M1', needsCoaching: true, coached: null, improved: false,
      }],
      loadMerchantInputs: async () => [{
        merchantId: 'M1', dataDate: '2026-08-21', sopRate: 70, signedThisMonth: true,
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
});
