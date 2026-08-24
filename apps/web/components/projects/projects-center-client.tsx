'use client';

import React, { useEffect, useState } from 'react';
import type { OperationsFilterOptions } from '../../lib/queries/operations-filters';
import type { ProjectListItem } from '../../lib/queries/projects';
import { OperationsFilterBar } from '../filters/operations-filter-bar';
import { useOperationsFilters } from '../filters/use-operations-filters';
import { ProjectDetail, type ProjectDetailData } from './project-detail';

type LegacyProjectDetailResponse = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  assignedAt: string;
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
  merchant?: { name: string };
};

function state(value: boolean | null) {
  return value === null ? '空白' : value ? '是' : '否';
}

export function ProjectsTable({
  items,
  onOpen,
}: {
  items: ProjectListItem[];
  onOpen(item: ProjectListItem): void;
}) {
  return <section className="panel data-table"><table><thead><tr><th scope="col">项目ID</th><th scope="col">装企</th><th scope="col">分派时间</th><th scope="col">需辅导</th><th scope="col">已辅导</th><th scope="col">已改善</th><th scope="col" /></tr></thead><tbody>{items.map((item) => <tr key={`${item.id}:${item.businessSource}`}><td><strong>{item.sourceProjectId}</strong></td><td><strong>{item.merchantName || '未匹配装企'}</strong><small className="secondary-id">{item.merchantId}</small></td><td>{item.assignedAt.slice(0,10)}</td><td>{state(item.needsCoaching)}</td><td>{state(item.coached)}</td><td>{state(item.improved)}</td><td><button onClick={() => onOpen(item)}>查看详情</button></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-state operations-empty-state">暂无符合条件的项目</div>}</section>;
}

function normalizeDetail(
  row: ProjectDetailData | LegacyProjectDetailResponse,
): ProjectDetailData {
  if ('businessSource' in row) return row;
  return {
    id: row.id,
    sourceProjectId: row.sourceProjectId,
    merchantId: row.merchantId,
    merchantName: row.merchant?.name ?? row.merchantId,
    businessSource: 'DESIGNBAO',
    dataDate: row.assignedAt.slice(0, 10),
    followWithin30m: row.followWithin30m,
    needsAnalyzed: row.needsAnalyzed,
    hardInvite: row.hardInvite,
    needsCoaching: row.needsCoaching,
    coached: row.coached,
    improved: row.improved,
    ruleHits: [],
  };
}

export function ProjectsCenterClient() {
  const operations = useOperationsFilters();
  const [filterOptions, setFilterOptions] = useState<OperationsFilterOptions | null>(null);
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [abnormal, setAbnormal] = useState(true);
  const [coached, setCoached] = useState('');
  const [improved, setImproved] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [detail, setDetail] = useState<ProjectDetailData | null>(null);
  const [detailTarget, setDetailTarget] = useState<ProjectListItem | null>(null);
  const load = () => {
    const extra: Record<string, string> = { abnormal: String(abnormal) };
    if (coached) extra.coached = coached;
    if (improved) extra.improved = improved;
    const query = operations.toSearchParams(extra);
    window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
    void fetch(`/api/projects?${query.toString()}`).then(async (response) => {
      setItems((await response.json() as { items: ProjectListItem[] }).items ?? []);
    });
  };
  const open = (item: ProjectListItem) => {
    setDetailTarget(item);
    const query = operations.toSearchParams({ dataDate: item.dataDate });
    query.set('source', item.businessSource);
    void fetch(`/api/projects/${encodeURIComponent(item.id)}?${query.toString()}`)
      .then(async (response) => {
        setDetail(normalizeDetail(await response.json() as ProjectDetailData | LegacyProjectDetailResponse));
      });
  };
  useEffect(() => {
    const url = new URLSearchParams(window.location.search);
    setAbnormal(url.get('abnormal') !== 'false');
    setCoached(url.get('coached') ?? '');
    setImproved(url.get('improved') ?? '');
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
      if (detailTarget) open(detailTarget);
    }
  }, [
    initialized,
    abnormal,
    coached,
    improved,
    operations.value.source,
    operations.value.regionId,
    operations.value.cityId,
    operations.value.merchantId,
  ]);
  return <div><header className="page-heading"><div><p className="eyebrow">项目中心</p><h1>定位具体问题项目</h1><p>默认优先显示需辅导、未改善和辅导结果空白的项目。</p></div></header>
    {filterOptions?.enabled && <OperationsFilterBar controller={operations} options={filterOptions} />}
    <section className="panel filter-bar"><select aria-label="辅导状态" value={coached} onChange={(event) => setCoached(event.target.value)}><option value="">全部辅导状态</option><option value="true">已辅导</option><option value="false">未辅导</option><option value="blank">辅导结果空白</option></select><select aria-label="改善状态" value={improved} onChange={(event) => setImproved(event.target.value)}><option value="">全部改善状态</option><option value="true">已改善</option><option value="false">未改善</option><option value="blank">改善结果空白</option></select><label className="switch"><input type="checkbox" checked={abnormal} onChange={(event) => setAbnormal(event.target.checked)} /><span>只看异常项目</span></label><button onClick={load}>查询</button></section>
    <ProjectsTable items={items} onOpen={open} />
    {detail && <aside className="detail-drawer"><button className="drawer-close" onClick={() => { setDetail(null); setDetailTarget(null); }}>×</button><ProjectDetail project={detail} filters={operations} /></aside>}
  </div>;
}
