import { metricCatalog, type MetricDefinition } from '@designbao/metrics/catalog';
import React from 'react';

export function selectAllMetricIds(): string[] {
  return metricCatalog.map((metric) => metric.id);
}

export function displayModeFor(count: number): 'TREND' | 'MATRIX' {
  return count >= 9 ? 'MATRIX' : 'TREND';
}

export const commonMetricIds = [
  'project_open_rate',
  'open_to_pk_rate',
  'open_to_deep_connection_rate',
  'dispatch_signed_rate',
  'follow_30m_execution_rate',
  'detailed_needs_rate',
  'quality_good_rate',
] as const;

export function MetricSelectionView({
  selectedIds,
  metrics,
  series = [],
}: {
  selectedIds: readonly string[];
  metrics: readonly MetricDefinition[];
  series?: Array<{ metricId: string; points: Array<{ value: number | null; numerator: number | null; denominator: number | null }> }>;
}) {
  const selected = new Set(selectedIds);
  const selectedMetrics = metrics.filter((metric) => selected.has(metric.id));
  const mode = displayModeFor(selectedMetrics.length);
  const latestValue = (metricId: string) => series.find((item) => item.metricId === metricId)?.points.at(-1);
  return (
    <section className="panel metric-result">
      <div className="section-heading">
        <div><p className="eyebrow">组合分析</p><h2>已选 {selectedMetrics.length}/{metrics.length}</h2></div>
        <span className="mode-pill">{mode === 'MATRIX' ? '分组矩阵' : '趋势对比'}</span>
      </div>
      {mode === 'MATRIX' ? (
        <div className="metric-matrix">
          {selectedMetrics.map((metric) => (
            <article key={metric.id} data-testid="metric-matrix-item" className="metric-matrix-item">
              <small>{metric.groupName}</small><strong>{metric.name}</strong>
              <span>{latestValue(metric.id)?.value ?? '—'}{metric.unit === 'RATE' && latestValue(metric.id)?.value != null ? '%' : ''}</span>
            </article>
          ))}
        </div>
      ) : (
        <div className="trend-placeholder" data-testid="metric-trend-view">
          <div className="trend-lines" aria-hidden="true"><i /><i /><i /></div>
          <div className="trend-list">
            {selectedMetrics.map((metric) => (
              <div key={metric.id}><span>{metric.name}</span><strong>{latestValue(metric.id)?.value ?? '—'}{metric.unit === 'RATE' && latestValue(metric.id)?.value != null ? '%' : ''}</strong></div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
