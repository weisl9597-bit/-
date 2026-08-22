import Link from 'next/link';
import React from 'react';

export type DashboardData = {
  dataDate: string | null;
  summary: { merchantTotal: number; abnormalProjects: number; coachingDue: number; unimproved: number };
  merchantStructure: Record<'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED', number>;
  alerts: { coaching: unknown[]; improvement: unknown[]; projects: unknown[] };
};

export function DashboardView({ data }: { data: DashboardData }) {
  const cards = [
    { label: '商家总数', value: data.summary.merchantTotal, href: '/merchants' },
    { label: '待辅导项目', value: data.summary.coachingDue, href: '/projects?coached=blank' },
    { label: '未改善项目', value: data.summary.unimproved, href: '/projects?improved=false' },
    { label: '异常项目', value: data.summary.abnormalProjects, href: '/projects?abnormal=true' },
  ];
  return (
    <div className="dashboard-grid">
      <header className="page-heading dashboard-heading">
        <div><p className="eyebrow">运营预警工作台</p><h1>今日需要关注什么？</h1></div>
        <span className="data-date">数据更新至 {data.dataDate ?? '等待首次上传'}</span>
      </header>
      <section className="summary-grid" aria-label="今日总览">
        {cards.map((card) => (
          <Link key={card.label} className="summary-card" href={card.href}>
            <span>{card.label}</span><strong>{card.value}</strong><small>查看明细 →</small>
          </Link>
        ))}
      </section>
      <section className="panel attention-panel">
        <div className="section-heading"><div><p className="eyebrow">今日关注</p><h2>异常处理入口</h2></div></div>
        <div className="attention-grid">
          <Link href="/projects?coached=blank" className="attention-card warning">
            <span>辅导执行异常</span><strong>{data.alerts.coaching.length}</strong><p>应辅导但辅导结果为空</p>
          </Link>
          <Link href="/projects?improved=false" className="attention-card danger">
            <span>商家改善异常</span><strong>{data.alerts.improvement.length}</strong><p>已进入观察但仍未改善</p>
          </Link>
          <Link href="/projects?abnormal=true" className="attention-card indigo">
            <span>项目异常</span><strong>{data.summary.abnormalProjects}</strong><p>查看需辅导、未改善及空白项目</p>
          </Link>
        </div>
      </section>
      <section className="panel merchant-structure">
        <div className="section-heading"><div><p className="eyebrow">经营状态</p><h2>商家结构</h2></div><Link href="/merchants">进入商家中心 →</Link></div>
        <div className="structure-grid">
          {Object.entries(data.merchantStructure).map(([classification, value]) => (
            <Link key={classification} href={`/merchants?classification=${classification}`} className={`structure-item state-${classification.toLowerCase()}`}>
              <span>{classification}</span><strong>{value}</strong>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
