'use client';

import React, { useEffect, useState } from 'react';
import type { OperationsFilterOptions } from '../../lib/queries/operations-filters';
import { OperationsFilterBar } from '../filters/operations-filter-bar';
import { useOperationsFilters } from '../filters/use-operations-filters';
import { MerchantDetail, type MerchantDetailData } from './merchant-detail';

type Item = {
  id: string;
  name: string;
  classification: string | null;
  dataAvailable?: boolean;
  sopRate: number | null;
  projectCount: number;
  lastAssignedAt: string | null;
};

type LegacyMerchantDetailResponse = {
  id: string;
  name: string;
  classificationSnapshots?: Array<{ classification: string; reason: string }>;
  metricSnapshots?: Array<{ metricId: string; value: number | string | null }>;
  projects?: Array<{ id: string; sourceProjectId: string }>;
};

function normalizeDetail(
  row: MerchantDetailData | LegacyMerchantDetailResponse,
): MerchantDetailData {
  if ('source' in row) return row;
  const current = row.classificationSnapshots?.[0];
  const sop = row.metricSnapshots?.find((metric) => metric.metricId === 'merchant_sop_compliance_rate');
  return {
    id: row.id,
    name: row.name,
    source: 'DESIGNBAO',
    classification: current?.classification ?? null,
    dataAvailable: true,
    reason: current?.reason ?? '暂无正式分类原因',
    sopRate: sop?.value === null || sop?.value === undefined ? null : Number(sop.value),
    projects: (row.projects ?? []).map((project) => ({
      id: project.id,
      sourceProjectId: project.sourceProjectId,
      businessSource: 'DESIGNBAO',
    })),
  };
}

export function MerchantsCenterClient() {
  const operations = useOperationsFilters();
  const [filterOptions, setFilterOptions] = useState<OperationsFilterOptions | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [classification, setClassification] = useState('');
  const [search, setSearch] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [detail, setDetail] = useState<MerchantDetailData | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const load = () => {
    const extra: Record<string, string> = {};
    if (classification) extra.classification = classification;
    if (search) extra.search = search;
    const query = operations.toSearchParams(extra);
    window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
    void fetch(`/api/merchants?${query.toString()}`).then(async (response) => {
      setItems((await response.json() as { items: Item[] }).items ?? []);
    });
  };
  const open = (id: string) => {
    setDetailId(id);
    const query = operations.toSearchParams();
    void fetch(`/api/merchants/${encodeURIComponent(id)}?${query.toString()}`)
      .then(async (response) => {
        const row = await response.json() as MerchantDetailData | LegacyMerchantDetailResponse;
        setDetail(normalizeDetail(row));
      });
  };
  useEffect(() => {
    const url = new URLSearchParams(window.location.search);
    setClassification(url.get('classification') ?? '');
    setSearch(url.get('search') ?? '');
    const id = url.get('id');
    if (id) open(id);
    setInitialized(true);
  }, []);
  useEffect(() => {
    void fetch(`/api/filters/operations?source=${operations.value.source}`)
      .then(async (response) => {
        if (response.ok) setFilterOptions(await response.json() as OperationsFilterOptions);
      });
  }, [operations.value.source]);
  useEffect(() => {
    if (initialized) {
      load();
      if (detailId) open(detailId);
    }
  }, [
    initialized,
    classification,
    operations.value.source,
    operations.value.regionId,
    operations.value.cityId,
    operations.value.merchantId,
  ]);
  return <div><header className="page-heading"><div><p className="eyebrow">商家中心</p><h1>管理商家经营状态</h1><p>查看A/B/C分类、变化原因与需要处理的项目。</p></div></header>
    {filterOptions?.enabled && <OperationsFilterBar controller={operations} options={filterOptions} />}
    <section className="panel filter-bar"><input placeholder="搜索商家" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} /><select value={classification} onChange={(event) => setClassification(event.target.value)}><option value="">全部分类</option>{['A','A_RISK','B','C_CANDIDATE','C','ELIMINATED'].map((item) => <option key={item}>{item}</option>)}</select><button onClick={load}>查询</button></section>
    <section className="panel data-table"><table><thead><tr><th>商家</th><th>分类</th><th>SOP达标率</th><th>项目数</th><th>最后分派</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td><span className="class-badge">{item.dataAvailable === false ? '该来源暂无数据' : (item.classification ?? '未分类')}</span></td><td>{item.sopRate === null ? '—' : `${item.sopRate}%`}</td><td>{item.projectCount}</td><td>{item.lastAssignedAt?.slice(0,10) ?? '—'}</td><td><button onClick={() => open(item.id)}>查看详情</button></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-state operations-empty-state">暂无符合条件的商家</div>}</section>
    {detail && <aside className="detail-drawer"><button className="drawer-close" onClick={() => { setDetail(null); setDetailId(null); }}>×</button><MerchantDetail merchant={detail} filters={operations} /></aside>}
  </div>;
}
