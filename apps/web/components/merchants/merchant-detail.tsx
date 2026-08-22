import Link from 'next/link';
import React from 'react';

export type MerchantDetailData = {
  id: string;
  name: string;
  classification: string | null;
  reason: string | null;
  sopRate: number | null;
  projects: Array<{ id: string; sourceProjectId: string }>;
};

export function MerchantDetail({ merchant }: { merchant: MerchantDetailData }) {
  return (
    <div className="detail-stack">
      <header className="detail-heading"><div><p className="eyebrow">商家详情</p><h2>{merchant.name}</h2></div><span className="class-badge">{merchant.classification ?? '未分类'}</span></header>
      <section className="detail-section"><h3>分类原因</h3><p>{merchant.reason ?? '暂无正式分类原因'}</p></section>
      <section className="detail-section"><h3>近期待观察指标</h3><div className="fact-row"><span>SOP执行达标率</span><strong>{merchant.sopRate === null ? '—' : `${merchant.sopRate}%`}</strong></div></section>
      <section className="detail-section"><div className="section-heading"><h3>项目明细</h3><Link href={`/projects?merchantId=${merchant.id}`}>查看全部项目 →</Link></div>
        {merchant.projects.map((project) => <div className="list-row" key={project.id}><span>{project.sourceProjectId}</span><Link href={`/projects?id=${encodeURIComponent(project.id)}`}>查看</Link></div>)}
      </section>
    </div>
  );
}
