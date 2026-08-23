import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardView } from '../components/dashboard/dashboard-view';
import { createOperationsFilterController } from '../components/filters/use-operations-filters';

describe('dashboard UI', () => {
  it('exposes the three operational alert entrances and merchant structure', () => {
    const filter = { source: 'XIAOHONGSHU' as const, regionId: 'region-1', cityId: 'city-1' };
    const filters = createOperationsFilterController(
      () => filter,
      () => undefined,
      () => undefined,
    );
    const html = renderToStaticMarkup(createElement(DashboardView, {
      data: {
        dataDate: '2026-08-21',
        source: 'XIAOHONGSHU',
        hasProjects: true,
        summary: { merchantTotal: 12, abnormalProjects: 3, coachingDue: 2, unimproved: 1 },
        merchantStructure: { A: 7, A_RISK: 1, B: 2, C_CANDIDATE: 1, C: 1, ELIMINATED: 0 },
        alerts: { coaching: [{}], improvement: [{}], projects: [{}] },
      },
      filters,
      filterOptions: {
        enabled: true,
        regions: [{ id: 'region-1', name: '华东大区' }],
        cities: [{ id: 'city-1', name: '杭州', parentId: 'region-1' }],
        merchants: [],
        rebuildStatus: { state: 'RUNNING', total: 3, completed: 1, failed: 0, lastSuccessfulDate: '2026-08-20' },
      },
    }));
    expect(html).toContain('辅导执行异常');
    expect(html).toContain('商家改善异常');
    expect(html).toContain('项目异常');
    expect(html).toContain('source=XIAOHONGSHU');
    expect(html).toContain('cityId=city-1');
    expect(html).toContain('abnormal=true');
    expect(html).toContain('数据更新至 2026-08-21（小红书）');
    expect(html).toContain('历史数据正在重建');
    expect(html).toContain('商家结构');
  });

  it('shows a scoped empty state when a successful batch has no matching projects', () => {
    const html = renderToStaticMarkup(createElement(DashboardView, {
      data: {
        dataDate: '2026-08-21', source: 'XIAOHONGSHU', hasProjects: false,
        summary: { merchantTotal: 0, abnormalProjects: 0, coachingDue: 0, unimproved: 0 },
        merchantStructure: { A: 0, A_RISK: 0, B: 0, C_CANDIDATE: 0, C: 0, ELIMINATED: 0 },
        alerts: { coaching: [], improvement: [], projects: [] },
      },
    }));
    expect(html).toContain('当前筛选范围暂无项目数据');
  });
});

