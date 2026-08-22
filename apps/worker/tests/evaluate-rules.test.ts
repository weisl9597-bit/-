import { describe, expect, it } from 'vitest';
import type { RuleEvaluationRepository } from '@designbao/rules/evaluate';
import { runEvaluateRulesJob } from '../src/jobs/evaluate-rules';

describe('rules worker job', () => {
  it('evaluates the selected source batch through the supplied repository', async () => {
    const repository: RuleEvaluationRepository = {
      loadProjectFacts: async () => [{
        projectId: 'P1::M1', merchantId: 'M1', needsCoaching: true, coached: null, improved: false,
      }],
      loadMerchantInputs: async () => [],
      persist: async () => undefined,
    };
    await expect(runEvaluateRulesJob({
      batchId: 'batch-1', dataDate: '2026-08-21', repository,
    })).resolves.toEqual({ projectAlertCount: 3, merchantDecisionCount: 0 });
  });
});
