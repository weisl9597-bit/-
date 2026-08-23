import { describe, expect, it } from 'vitest';
import { evaluateProjectAlerts } from '../src/project-alerts';

describe('project alerts', () => {
  it('returns every matching fact without assigning a severity level', () => {
    expect(evaluateProjectAlerts({
      projectId: 'P1::M1', merchantId: 'M1', businessSource: 'DESIGNBAO', needsCoaching: true,
      coached: null, improved: false,
    })).toEqual([
      expect.objectContaining({ code: 'NEEDS_COACHING', projectId: 'P1::M1', businessSource: 'DESIGNBAO', ruleVersion: 'v2' }),
      expect.objectContaining({ code: 'NOT_IMPROVED', projectId: 'P1::M1' }),
      expect.objectContaining({ code: 'COACHING_BLANK', projectId: 'P1::M1' }),
    ]);
  });

  it('returns no alert when none of the three facts match', () => {
    expect(evaluateProjectAlerts({
      projectId: 'P2::M1', merchantId: 'M1', businessSource: 'XIAOHONGSHU', needsCoaching: false,
      coached: true, improved: true,
    })).toEqual([]);
  });
});

