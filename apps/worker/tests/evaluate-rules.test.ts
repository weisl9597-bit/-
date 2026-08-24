import { describe, expect, it } from 'vitest';
import type { RuleEvaluationRepository } from '@designbao/rules/evaluate';
import {
  decisionsForRollout,
  rulePersistenceTransactionOptions,
  runEvaluateRulesJob,
  selectHistoricalAssignments,
  sourceScopedOverrideState,
} from '../src/jobs/evaluate-rules';

describe('rules worker job', () => {
  it('allows the source-aware classification rebuild to outlive Prisma interactive defaults', () => {
    expect(rulePersistenceTransactionOptions.timeout).toBeGreaterThanOrEqual(60_000);
    expect(rulePersistenceTransactionOptions.maxWait).toBeGreaterThanOrEqual(10_000);
  });

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

  it('writes only the legacy ALL classification during the expand-only rollout phase', () => {
    const decision = (businessSource: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL') => ({
      merchantId: 'M1', businessSource, dataAvailable: true,
      suggested: 'B' as const, requiresConfirmation: false, ruleVersion: 'v2' as const,
      evidence: [], reason: '测试',
    });
    const decisions = [decision('DESIGNBAO'), decision('XIAOHONGSHU'), decision('ALL')];
    expect(decisionsForRollout(decisions, false).map((item) => item.businessSource)).toEqual(['ALL']);
    expect(decisionsForRollout(decisions, true)).toHaveLength(3);
  });

  it('uses only the latest successful assignment version available as of the historical date', () => {
    const selected = selectHistoricalAssignments([
      {
        batchId: 'old',
        projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-20'), assignedAt: new Date('2026-08-20T10:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-20T11:00:00Z'),
      },
      {
        batchId: 'corrected',
        projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-20'), assignedAt: new Date('2026-08-19T10:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-21T11:00:00Z'),
      },
      {
        batchId: 'future',
        projectId: 'P2::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-22'), assignedAt: new Date('2026-08-22T10:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-22T11:00:00Z'),
      },
      {
        batchId: 'failed',
        projectId: 'P3::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-21'), assignedAt: new Date('2026-08-21T10:00:00Z'),
        batchStatus: 'FAILED', batchCreatedAt: new Date('2026-08-21T11:00:00Z'),
      },
    ], new Date('2026-08-21T00:00:00Z'));

    expect(selected).toHaveLength(1);
    expect(selected[0]?.assignedAt.toISOString()).toBe('2026-08-19T10:00:00.000Z');
  });

  it('drops projects omitted by the latest corrected batch for a historical date', () => {
    const rows = [
      {
        batchId: 'old', projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-20'), assignedAt: new Date('2026-08-19T10:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-20T11:00:00Z'),
      },
      {
        batchId: 'old', projectId: 'REMOVED::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-20'), assignedAt: new Date('2026-08-19T09:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-20T11:00:00Z'),
      },
      {
        batchId: 'different-date', projectId: 'P2::M1', merchantId: 'M1', businessSource: 'DESIGNBAO',
        dataDate: new Date('2026-08-19'), assignedAt: new Date('2026-08-18T10:00:00Z'),
        batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-19T11:00:00Z'),
      },
    ] as const;
    const selected = selectHistoricalAssignments(rows, new Date('2026-08-21T00:00:00Z'), [
      { batchId: 'old', dataDate: new Date('2026-08-20'), batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-20T11:00:00Z') },
      { batchId: 'corrected-empty', dataDate: new Date('2026-08-20'), batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-21T11:00:00Z') },
      { batchId: 'different-date', dataDate: new Date('2026-08-19'), batchStatus: 'SUCCEEDED', batchCreatedAt: new Date('2026-08-19T11:00:00Z') },
    ]);

    expect(selected.map((row) => row.projectId)).toEqual(['P2::M1']);
  });
});

