import Link from 'next/link';
import React from 'react';
import type { OperationsFilterController } from '../filters/use-operations-filters';

export type MerchantDetailData = {
  id: string;
  name: string;
  source: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
  classification: string | null;
  dataAvailable: boolean;
  reason: string;
  sopRate: number | null;
  projects: Array<{
    id: string;
    sourceProjectId: string;
    businessSource: 'DESIGNBAO' | 'XIAOHONGSHU';
  }>;
};

export function MerchantDetail({
  merchant,
  filters,
}: {
  merchant: MerchantDetailData;
  filters?: OperationsFilterController;
}) {
  const projectHref = (extra: Record<string, string>) => {
    const params = filters?.toSearchParams() ?? new URLSearchParams({ source: merchant.source });
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return `/projects?${params.toString()}`;
  };
  return (
    <div className="detail-stack">
      <header className="detail-heading"><div><p className="eyebrow">商家详情</p><h2>{merchant.name}</h2></div><span className="class-badge">{merchant.dataAvailable ? (merchant.classification ?? '未分类') : '该来源暂无数据'}</span></header>
      <section className="detail-section"><h3>分类原因</h3><p>{merchant.reason}</p></section>
      <section className="detail-section"><h3>近期待观察指标</h3><div className="fact-row"><span>SOP执行达标率</span><strong>{merchant.sopRate === null ? '—' : `${merchant.sopRate}%`}</strong></div></section>
      <section className="detail-section"><div className="section-heading"><h3>项目明细</h3><Link href={projectHref({ merchantId: merchant.id })}>查看全部项目 →</Link></div>
        {merchant.projects.map((project) => <div className="list-row" key={`${project.id}:${project.businessSource}`}><span>{project.sourceProjectId}</span><Link href={projectHref({ id: project.id })}>查看</Link></div>)}
      </section>
    </div>
  );
}

