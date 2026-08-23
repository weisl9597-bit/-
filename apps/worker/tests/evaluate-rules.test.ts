import { describe, expect, it } from 'vitest';
import type { RuleEvaluationRepository } from '@designbao/rules/evaluate';
import { runEvaluateRulesJob, sourceScopedOverrideState } from '../src/jobs/evaluate-rules';

describe('rules worker job', () => {
  it('evaluates the selected source batch through the supplied repository', async () => {
    const repository: RuleEvaluationRepository = {
      loadProjectFacts: async () => [{
        projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        needsCoaching: true, coached: null, improved: false,
      }],
      loadMerchantInputs: async () => [],
      persist: async () => undefined,
    };
    await expect(runEvaluateRulesJob({
      batchId: 'batch-1', dataDate: '2026-08-21', repository,
    })).resolves.toEqual({ projectAlertCount: 3, merchantDecisionCount: 0 });
  });

  it('applies non-global overrides only to their source and global exclusion to all sources', () => {
    const overrides = [
      { type: 'CONFIRM_C' as const, businessSource: 'DESIGNBAO' as const, endDate: null },
      { type: 'PERMANENT_EXCLUDE' as const, businessSource: null, endDate: null },
    ];
    expect(sourceScopedOverrideState(overrides, 'DESIGNBAO')).toMatchObject({ cConfirmed: true, permanentlyExcluded: true });
    expect(sourceScopedOverrideState(overrides, 'XIAOHONGSHU')).toMatchObject({ cConfirmed: false, permanentlyExcluded: true });
    expect(sourceScopedOverrideState(overrides, 'ALL')).toMatchObject({ cConfirmed: false, permanentlyExcluded: true });
  });
});

