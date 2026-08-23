'use client';

import React, { useEffect, useState } from 'react';
import { MerchantDecisionPanel } from './merchant-decision-panel';

type Candidate = {
  id: string;
  merchantId: string;
  suggested: string;
  businessSource: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
  reason: string;
  merchant: { name: string };
};

export function MerchantDecisionsClient() {
  const [items, setItems] = useState<Candidate[]>([]);
  const [source, setSource] = useState<'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL'>('DESIGNBAO');
  const [loading, setLoading] = useState(true);
  const load = () => {
    setLoading(true);
    void fetch(`/api/admin/merchant-decisions?source=${source}`).then(async (response) => {
      if (!response.ok) throw new Error('商家候选列表加载失败');
      setItems((await response.json() as { items: Candidate[] }).items);
    }).finally(() => setLoading(false));
  };
  useEffect(load, [source]);
  return <div><header className="page-heading"><div><p className="eyebrow">管理后台</p><h1>商家决策</h1><p>审核待确认商家。所有操作必须填写原因，并自动保留操作记录。</p></div><label><span>业务来源</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="DESIGNBAO">设计宝</option><option value="XIAOHONGSHU">小红书</option><option value="ALL">全部业务</option></select></label></header>
    {loading && <div className="inline-loading">正在加载待确认商家…</div>}
    {!loading && items.length === 0 && <section className="panel empty-state">当前没有待确认商家</section>}
    <section className="decision-grid">{items.map((item) => <MerchantDecisionPanel key={item.id} merchantId={item.merchantId} merchantName={item.merchant.name} businessSource={item.businessSource} suggested={item.suggested} reason={item.reason} onSaved={load} />)}</section>
  </div>;
}

