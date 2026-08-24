import Link from 'next/link';
import React from 'react';
import type { OperationsFilterOptions } from '../../lib/queries/operations-filters';
import { OperationsFilterBar } from '../filters/operations-filter-bar';
import type { OperationsFilterController } from '../filters/use-operations-filters';

export type DashboardData = {
  dataDate: string | null;
  source: 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';
  hasProjects: boolean;
  summary: { merchantTotal: number; abnormalProjects: number; coachingDue: number; unimproved: number };
  merchantStructure: Record<'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED', number>;
  alerts: { coaching: unknown[]; improvement: unknown[]; projects: unknown[] };
};

const SOURCE_LABELS = {
  DESIGNBAO: '设计宝', XIAOHONGSHU: '小红书', ALL: '全部业务',
} as const;

export function DashboardView({
  data,
  filters,
  filterOptions,
}: {
  data: DashboardData;
  filters?: OperationsFilterController;
  filterOptions?: OperationsFilterOptions;
}) {
  const href = (pathname: string, extra: Record<string, string> = {}) => {
    if (!filters) {
      const query = new URLSearchParams(extra).toString();
      return query ? `${pathname}?${query}` : pathname;
    }
    return `${pathname}?${filters.toSearchParams(extra).toString()}`;
  };
  const cards = [
    { label: '商家总数', value: data.summary.merchantTotal, href: href('/merchants') },
    { label: '待辅导项目', value: data.summary.coachingDue, href: href('/projects', { coached: 'blank' }) },
    { label: '未改善项目', value: data.summary.unimproved, href: href('/projects', { improved: 'false' }) },
    { label: '异常项目', value: data.summary.abnormalProjects, href: href('/projects', { abnormal: 'true' }) },
  ];
  return (
    <div className="dashboard-grid">
      <header className="page-heading dashboard-heading">
        <div><p className="eyebrow">运营预警工作台</p><h1>今日需要关注什么？</h1></div>
        <span className="data-date">数据更新至 {data.dataDate ?? '等待首次上传'}（{SOURCE_LABELS[data.source]}）</span>
      </header>
      {filterOptions?.enabled && filters && <OperationsFilterBar
        controller={filters}
        options={filterOptions}
      />}
      {data.dataDate && !data.hasProjects ? <section className="panel empty-state operations-empty-state">
        <h2>当前筛选范围暂无项目数据</h2>
        <p>可切换业务来源或组织范围后重试。</p>
      </section> : <>
      <section className="summary-grid" aria-label="今日总览">
        {cards.map((card) => (
          <Link key={card.label} className="summary-card" href={card.href}>
            <span>{card.label}</span><strong>{card.value}</strong><small>查看明细 →</small>
          </Link>
        ))}
      </section>
      <section className="panel attention-panel">
        <div className="section-heading"><div><p className="eyebrow">今日关注 · 近72小时内分派项目</p><h2>异常处理入口</h2></div></div>
        <div className="attention-grid">
          <Link href={href('/projects', { coached: 'blank' })} className="attention-card warning">
            <span>辅导执行异常</span><strong>{data.alerts.coaching.length}</strong><p>应辅导但辅导结果为空</p>
          </Link>
          <Link href={href('/projects', { improved: 'false' })} className="attention-card danger">
            <span>商家改善异常</span><strong>{data.alerts.improvement.length}</strong><p>已进入观察但仍未改善</p>
          </Link>
          <Link href={href('/projects', { abnormal: 'true' })} className="attention-card indigo">
            <span>项目异常</span><strong>{data.summary.abnormalProjects}</strong><p>查看需辅导、未改善及空白项目</p>
          </Link>
        </div>
      </section>
      <section className="panel merchant-structure">
        <div className="section-heading"><div><p className="eyebrow">经营状态</p><h2>商家结构</h2></div><Link href={href('/merchants')}>进入商家中心 →</Link></div>
        <div className="structure-grid">
          {Object.entries(data.merchantStructure).map(([classification, value]) => (
            <Link key={classification} href={href('/merchants', { classification })} className={`structure-item state-${classification.toLowerCase()}`}>
              <span>{classification}</span><strong>{value}</strong>
            </Link>
          ))}
        </div>
      </section>
      </>}
    </div>
  );
}
