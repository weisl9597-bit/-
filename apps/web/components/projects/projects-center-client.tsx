'use client';

import React, { useEffect, useState } from 'react';
import { ProjectDetail, type ProjectDetailData } from './project-detail';

type Item = { id: string; sourceProjectId: string; merchantId: string; assignedAt: string; needsCoaching: boolean | null; coached: boolean | null; improved: boolean | null };
type ProjectDetailResponse = Item & {
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  merchant?: { name: string };
};
function state(value: boolean | null) { return value === null ? '空白' : value ? '是' : '否'; }

export function ProjectsCenterClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [abnormal, setAbnormal] = useState(true);
  const [merchantId, setMerchantId] = useState('');
  const [coached, setCoached] = useState('');
  const [improved, setImproved] = useState('');
  const [initialized, setInitialized] = useState(false);
  const [detail, setDetail] = useState<ProjectDetailData | null>(null);
  const load = () => {
    const query = new URLSearchParams({ abnormal: String(abnormal) });
    if (merchantId) query.set('merchantId', merchantId);
    if (coached) query.set('coached', coached);
    if (improved) query.set('improved', improved);
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`);
    void fetch(`/api/projects?${query}`).then(async (response) => setItems((await response.json() as { items: Item[] }).items ?? []));
  };
  const open = (id: string) => void fetch(`/api/projects/${encodeURIComponent(id)}`).then(async (response) => {
    const row = await response.json() as ProjectDetailResponse;
    setDetail({ id: row.id, sourceProjectId: row.sourceProjectId, merchantId: row.merchantId, merchantName: row.merchant?.name ?? row.merchantId, followWithin30m: row.followWithin30m, needsAnalyzed: row.needsAnalyzed, hardInvite: row.hardInvite, needsCoaching: row.needsCoaching, coached: row.coached, improved: row.improved });
  });
  useEffect(() => {
    const url = new URLSearchParams(window.location.search);
    setAbnormal(url.get('abnormal') !== 'false');
    setMerchantId(url.get('merchantId') ?? '');
    setCoached(url.get('coached') ?? '');
    setImproved(url.get('improved') ?? '');
    const id = url.get('id');
    if (id) open(id);
    setInitialized(true);
  }, []);
  useEffect(() => {
    if (initialized) load();
  }, [initialized, abnormal, coached, improved]);
  return <div><header className="page-heading"><div><p className="eyebrow">项目中心</p><h1>定位具体问题项目</h1><p>默认优先显示需辅导、未改善和辅导结果空白的项目。</p></div></header>
    <section className="panel filter-bar"><input placeholder="商家ID" value={merchantId} onChange={(event) => setMerchantId(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && load()} /><select aria-label="辅导状态" value={coached} onChange={(event) => setCoached(event.target.value)}><option value="">全部辅导状态</option><option value="true">已辅导</option><option value="false">未辅导</option><option value="blank">辅导结果空白</option></select><select aria-label="改善状态" value={improved} onChange={(event) => setImproved(event.target.value)}><option value="">全部改善状态</option><option value="true">已改善</option><option value="false">未改善</option><option value="blank">改善结果空白</option></select><label className="switch"><input type="checkbox" checked={abnormal} onChange={(event) => setAbnormal(event.target.checked)} /><span>只看异常项目</span></label><button onClick={load}>查询</button></section>
    <section className="panel data-table"><table><thead><tr><th>项目ID</th><th>商家ID</th><th>分派时间</th><th>需辅导</th><th>已辅导</th><th>已改善</th><th /></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><strong>{item.sourceProjectId}</strong></td><td>{item.merchantId}</td><td>{item.assignedAt.slice(0,10)}</td><td>{state(item.needsCoaching)}</td><td>{state(item.coached)}</td><td>{state(item.improved)}</td><td><button onClick={() => open(item.id)}>查看详情</button></td></tr>)}</tbody></table>{items.length === 0 && <div className="empty-state">暂无符合条件的项目</div>}</section>
    {detail && <aside className="detail-drawer"><button className="drawer-close" onClick={() => setDetail(null)}>×</button><ProjectDetail project={detail} /></aside>}
  </div>;
}
