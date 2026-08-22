import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { metricCatalog } from '@designbao/metrics/catalog';
import { MetricSelectionView, displayModeFor, selectAllMetricIds } from '../components/metrics/metric-selection';

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
});
