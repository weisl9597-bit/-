'use client';

import { metricCatalog } from '@designbao/metrics/catalog';
import React, { useEffect, useMemo, useState } from 'react';
import { commonMetricIds, MetricSelectionView, selectAllMetricIds } from './metric-selection';

type MetricResponse = {
  series: Array<{ metricId: string; points: Array<{ value: number | null; numerator: number | null; denominator: number | null }> }>;
};

const groupOrder = ['dispatch_open', 'open_pk', 'conversion', 'designer_sop', 'group_sync', 'chat_quality'];

function defaultDates() {
  const end = new Date();
  const start = new Date(end); start.setDate(start.getDate() - 29);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function MetricsCenterClient() {
  const dates = useMemo(defaultDates, []);
  const [selected, setSelected] = useState<string[]>([...commonMetricIds]);
  const [search, setSearch] = useState('');
  const [grain, setGrain] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK');
  const [start, setStart] = useState(dates.start);
  const [end, setEnd] = useState(dates.end);
  const [initialized, setInitialized] = useState(false);
  const [data, setData] = useState<MetricResponse>({ series: [] });
  const [loading, setLoading] = useState(false);
  const visible = metricCatalog.filter((metric) => metric.name.toLowerCase().includes(search.toLowerCase()));
  const selectedSet = new Set(selected);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const selectGroup = (groupId: string) => setSelected((current) => [...new Set([...current, ...metricCatalog.filter((metric) => metric.groupId === groupId).map((metric) => metric.id)])]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ids = params.get('metricIds')?.split(',').filter(Boolean);
    if (ids?.length) setSelected(ids);
    const requestedGrain = params.get('grain');
    if (requestedGrain === 'DAY' || requestedGrain === 'WEEK' || requestedGrain === 'MONTH') setGrain(requestedGrain);
    if (params.get('start')) setStart(params.get('start')!);
    if (params.get('end')) setEnd(params.get('end')!);
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    const params = new URLSearchParams(window.location.search);
    params.set('metricIds', selected.join(',')); params.set('grain', grain); params.set('start', start); params.set('end', end);
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    if (selected.length === 0) { setData({ series: [] }); return; }
    setLoading(true);
    const query = new URLSearchParams({ metricIds: selected.join(','), grain, start, end });
    void fetch(`/api/metrics?${query}`).then(async (response) => {
      if (!response.ok) throw new Error('指标数据加载失败');
      setData(await response.json() as MetricResponse);
    }).finally(() => setLoading(false));
  }, [initialized, selected.join(','), grain, start, end]);

  return (
    <div className="metrics-layout">
      <header className="page-heading"><div><p className="eyebrow">指标中心</p><h1>常用指标与自由组合分析</h1><p>可选择任意数量指标；1—8项显示趋势，9项以上切换为矩阵。</p></div></header>
      <section className="panel common-metrics"><div className="section-heading"><div><p className="eyebrow">常用入口</p><h2>常见指标</h2></div><div className="metric-time-tools"><label>开始<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>结束<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label><div className="segmented">{(['DAY', 'WEEK', 'MONTH'] as const).map((item) => <button className={grain === item ? 'active' : ''} key={item} onClick={() => setGrain(item)}>{item === 'DAY' ? '日' : item === 'WEEK' ? '周' : '月'}</button>)}</div></div></div>
        <div className="chip-row">{commonMetricIds.map((id) => { const metric = metricCatalog.find((item) => item.id === id)!; return <button key={id} className={selectedSet.has(id) ? 'chip selected' : 'chip'} onClick={() => toggle(id)}>{metric.name}</button>; })}</div>
      </section>
      <div className="metrics-workspace">
        <aside className="panel metric-catalog-panel"><div className="catalog-tools"><input aria-label="搜索指标" placeholder="搜索40个指标" value={search} onChange={(event) => setSearch(event.target.value)} /><button onClick={() => setSelected(selectAllMetricIds())}>全选全部</button><button onClick={() => setSelected([])}>清空</button></div>
          {groupOrder.map((groupId) => { const group = visible.filter((metric) => metric.groupId === groupId); if (!group.length) return null; return <section key={groupId} className="catalog-group"><div><strong>{group[0]!.groupName}</strong><button onClick={() => selectGroup(groupId)}>全选本组</button></div>{group.map((metric) => <label key={metric.id}><input type="checkbox" checked={selectedSet.has(metric.id)} onChange={() => toggle(metric.id)} /><span>{metric.name}</span><small>{metric.unit === 'RATE' ? '%' : '数值'}</small></label>)}</section>; })}
        </aside>
        <div>{loading && <div className="inline-loading">正在更新分析…</div>}<MetricSelectionView selectedIds={selected} metrics={metricCatalog} series={data.series} /></div>
      </div>
    </div>
  );
}
