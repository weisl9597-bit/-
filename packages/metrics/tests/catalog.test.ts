import { describe, expect, it } from 'vitest';
import { managementMetricCatalog, metricCatalog } from '../src/catalog';

describe('metric catalog', () => {
  it('contains every indicator from the supplied data document', () => {
    expect(metricCatalog).toHaveLength(40);
    expect(metricCatalog.reduce<Record<string, number>>((counts, metric) => {
      counts[metric.groupId] = (counts[metric.groupId] ?? 0) + 1;
      return counts;
    }, {})).toEqual({
      dispatch_open: 8,
      open_pk: 2,
      conversion: 12,
      designer_sop: 6,
      group_sync: 6,
      chat_quality: 6,
    });
    expect(new Set(metricCatalog.map((metric) => metric.id)).size).toBe(40);
    expect(metricCatalog.map((metric) => metric.name)).toContain('硬约沟通/量房数');
  });

  it('keeps merchant SOP compliance as a management metric', () => {
    expect(managementMetricCatalog).toEqual([
      expect.objectContaining({ id: 'merchant_sop_compliance_rate', unit: 'RATE' }),
    ]);
  });
});
