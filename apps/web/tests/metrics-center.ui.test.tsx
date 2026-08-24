import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { metricCatalog } from '@designbao/metrics/catalog';
import { MetricsCenterClient } from '../components/metrics/metrics-center-client';
import { MetricSelectionView, displayModeFor, selectAllMetricIds } from '../components/metrics/metric-selection';
import { createOperationsFilterController } from '../components/filters/use-operations-filters';

describe('metrics center UI', () => {
  it('supports selecting every supplied document indicator', () => {
    const selected = selectAllMetricIds();
    const html = renderToStaticMarkup(createElement(MetricSelectionView, {
      selectedIds: selected,
      metrics: metricCatalog,
    }));
    expect(selected).toHaveLength(40);
    expect(html).toContain('已选 40/40');
    expect((html.match(/data-testid="metric-matrix-item"/g) ?? [])).toHaveLength(40);
  });

  it('uses trends for up to eight metrics and a matrix from nine onward', () => {
    expect(displayModeFor(8)).toBe('TREND');
    expect(displayModeFor(9)).toBe('MATRIX');
    expect(displayModeFor(40)).toBe('MATRIX');
  });

  it('uses the one shared operations filter bar without a duplicate source selector', () => {
    const current = { source: 'DESIGNBAO' as const, cityId: 'city-1' };
    const operations = createOperationsFilterController(
      () => current,
      () => undefined,
      () => undefined,
    );
    const html = renderToStaticMarkup(createElement(MetricsCenterClient, {
      operations,
      filterOptions: {
        enabled: true,
        regions: [{ id: 'region-1', name: '华南大区' }],
        cities: [{ id: 'city-1', name: '广州市', parentId: 'region-1' }],
        merchants: [],
        rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
      },
    }));
    expect((html.match(/aria-label="业务来源"/g) ?? [])).toHaveLength(1);
    expect(html).toContain('operations-filter-bar');
    expect(html).not.toContain('metric-filter-bar');
  });

  it('keeps the legacy source selector but hides new organization filters while rollout is off', () => {
    const current = { source: 'DESIGNBAO' as const };
    const operations = createOperationsFilterController(
      () => current,
      () => undefined,
      () => undefined,
    );
    const html = renderToStaticMarkup(createElement(MetricsCenterClient, {
      operations,
      sourceAwareEnabled: false,
      filterOptions: {
        enabled: false,
        regions: [{ id: 'region-1', name: '华南大区' }],
        cities: [], merchants: [],
        rebuildStatus: { state: 'IDLE', total: 0, completed: 0, failed: 0, lastSuccessfulDate: null },
      },
    }));
    expect(html).toContain('legacy-source-filter');
    expect((html.match(/aria-label="业务来源"/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('aria-label="大区"');
    expect(html).not.toContain('aria-label="城市"');
    expect(html).not.toContain('aria-label="商家"');
  });

  it('uses runtime filter status instead of a stale build-time rollout flag', () => {
    const current = { source: 'DESIGNBAO' as const };
    const operations = createOperationsFilterController(
      () => current,
      () => undefined,
      () => undefined,
    );
    const html = renderToStaticMarkup(createElement(MetricsCenterClient, {
      operations,
      sourceAwareEnabled: false,
      filterOptions: {
        enabled: true,
        regions: [{ id: 'region-1', name: '北京大区' }],
        cities: [{ id: 'city-1', name: '北京市', parentId: 'region-1' }],
        merchants: [{ id: 'M1', name: '示例装企', organizationId: 'city-1' }],
        rebuildStatus: { state: 'IDLE', total: 1, completed: 1, failed: 0, lastSuccessfulDate: '2026-08-23' },
      },
    }));
    expect(html).toContain('aria-label="大区"');
    expect(html).toContain('aria-label="城市"');
    expect(html).toContain('aria-label="商家"');
    expect(html).not.toContain('legacy-source-filter');
  });
});
