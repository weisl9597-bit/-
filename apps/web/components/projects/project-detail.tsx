import Link from 'next/link';
import React from 'react';

export type ProjectDetailData = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  merchantName: string;
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
};

function value(input: boolean | null): string {
  return input === null ? '空白' : input ? '是' : '否';
}

export function ProjectDetail({ project }: { project: ProjectDetailData }) {
  const sop = project.followWithin30m === true && project.needsAnalyzed === true && project.hardInvite === false;
  return (
    <div className="detail-stack">
      <header className="detail-heading"><div><p className="eyebrow">项目详情</p><h2>{project.sourceProjectId}</h2></div><span className={`status-pill ${sop ? 'success' : 'danger'}`}>{sop ? 'SOP达标' : 'SOP未达标'}</span></header>
      <section className="detail-section"><h3>SOP执行明细</h3>
        <div className="fact-row"><span>30min内跟进</span><strong>{value(project.followWithin30m)}</strong></div>
        <div className="fact-row"><span>详细需求沟通/户型解析</span><strong>{value(project.needsAnalyzed)}</strong></div>
        <div className="fact-row"><span>硬约沟通/量房</span><strong>{value(project.hardInvite)}</strong></div>
      </section>
      <section className="detail-section"><h3>运营状态</h3>
        <div className="fact-row"><span>是否需辅导</span><strong>{value(project.needsCoaching)}</strong></div>
        <div className="fact-row"><span>是否辅导</span><strong>{value(project.coached)}</strong></div>
        <div className="fact-row"><span>是否改善</span><strong>{value(project.improved)}</strong></div>
      </section>
      <Link className="button-link" href={`/merchants?id=${project.merchantId}`}>返回所属商家：{project.merchantName}</Link>
    </div>
  );
}
