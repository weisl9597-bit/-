'use client';

import { metricCatalog } from '@designbao/metrics/catalog';
import React, { useEffect, useMemo, useState } from 'react';
import { commonMetricIds, MetricSelectionView, selectAllMetricIds } from './metric-selection';

type MetricResponse = {
  series: Array<{ metricId: string; points: Array<{ value: number | null; numerator: number | null; denominator: number | null }> }>;
};

type MetricFilterResponse = {
  regions: Array<{ id: string; name: string }>;
  cities: Array<{ id: string; name: string; parentId: string }>;
  merchants: Array<{ id: string; name: string; organizationId: string }>;
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
  const [source, setSource] = useState<'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL'>('DESIGNBAO');
  const [regionId, setRegionId] = useState('');
  const [cityId, setCityId] = useState('');
  const [merchantId, setMerchantId] = useState('');
  const [filters, setFilters] = useState<MetricFilterResponse>({ regions: [], cities: [], merchants: [] });
  const [initialized, setInitialized] = useState(false);
  const [data, setData] = useState<MetricResponse>({ series: [] });
  const [loading, setLoading] = useState(false);
  const visible = metricCatalog.filter((metric) => metric.name.toLowerCase().includes(search.toLowerCase()));
  const selectedSet = new Set(selected);
  const visibleCities = filters.cities.filter((city) => !regionId || city.parentId === regionId);
  const visibleMerchants = filters.merchants.filter((merchant) => !cityId || merchant.organizationId === cityId);
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
    const requestedSource = params.get('source');
    if (requestedSource === 'DESIGNBAO' || requestedSource === 'XIAOHONGSHU' || requestedSource === 'ALL') setSource(requestedSource);
    if (params.get('regionId')) setRegionId(params.get('regionId')!);
    if (params.get('cityId')) setCityId(params.get('cityId')!);
    if (params.get('merchantId')) setMerchantId(params.get('merchantId')!);
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;
    void fetch('/api/metrics/filters').then(async (response) => {
      if (!response.ok) throw new Error('筛选项加载失败');
      const next = await response.json() as MetricFilterResponse;
      setFilters(next);
      if (!regionId && next.regions.length === 1) setRegionId(next.regions[0]!.id);
      if (!cityId && next.cities.length === 1) setCityId(next.cities[0]!.id);
    });
  }, [initialized]);

  useEffect(() => {
    if (!initialized) return;
    const params = new URLSearchParams(window.location.search);
    params.set('metricIds', selected.join(',')); params.set('grain', grain); params.set('start', start); params.set('end', end); params.set('source', source);
    for (const [name, value] of [['regionId', regionId], ['cityId', cityId], ['merchantId', merchantId]] as const) {
      if (value) params.set(name, value); else params.delete(name);
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    if (selected.length === 0) { setData({ series: [] }); return; }
    setLoading(true);
    const query = new URLSearchParams({ metricIds: selected.join(','), grain, start, end, source });
    const organizationId = cityId || regionId;
    if (organizationId) query.set('organizationId', organizationId);
    if (merchantId) query.set('merchantId', merchantId);
    void fetch(`/api/metrics?${query}`).then(async (response) => {
      if (!response.ok) throw new Error('指标数据加载失败');
      setData(await response.json() as MetricResponse);
    }).finally(() => setLoading(false));
  }, [initialized, selected.join(','), grain, start, end, source, regionId, cityId, merchantId]);

  return (
    <div className="metrics-layout">
      <header className="page-heading"><div><p className="eyebrow">指标中心</p><h1>常用指标与自由组合分析</h1><p>可选择任意数量指标；1—8项显示趋势，9项以上切换为矩阵。</p></div></header>
      <section className="panel common-metrics">
        <div className="metric-filter-bar">
          <label>业务来源<select aria-label="业务来源" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="DESIGNBAO">设计宝</option><option value="XIAOHONGSHU">小红书</option><option value="ALL">全部业务</option></select></label>
          <label>大区<select aria-label="大区" value={regionId} onChange={(event) => { setRegionId(event.target.value); setCityId(''); setMerchantId(''); }}><option value="">全部大区</option>{filters.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label>
          <label>城市<select aria-label="城市" value={cityId} disabled={!regionId} onChange={(event) => { setCityId(event.target.value); setMerchantId(''); }}><option value="">全部城市</option>{visibleCities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></label>
          <label>商家<select aria-label="商家" value={merchantId} disabled={!cityId} onChange={(event) => setMerchantId(event.target.value)}><option value="">全部商家</option>{visibleMerchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}</select></label>
        </div>
        <div className="section-heading"><div><p className="eyebrow">常用入口</p><h2>常见指标</h2></div><div className="metric-time-tools"><label>开始<input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>结束<input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label><div className="segmented">{(['DAY', 'WEEK', 'MONTH'] as const).map((item) => <button className={grain === item ? 'active' : ''} key={item} onClick={() => setGrain(item)}>{item === 'DAY' ? '日' : item === 'WEEK' ? '周' : '月'}</button>)}</div></div></div>
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
