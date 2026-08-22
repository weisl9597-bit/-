import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DashboardView } from '../components/dashboard/dashboard-view';

describe('dashboard UI', () => {
  it('exposes the three operational alert entrances and merchant structure', () => {
    const html = renderToStaticMarkup(createElement(DashboardView, {
      data: {
        dataDate: '2026-08-21',
        summary: { merchantTotal: 12, abnormalProjects: 3, coachingDue: 2, unimproved: 1 },
        merchantStructure: { A: 7, A_RISK: 1, B: 2, C_CANDIDATE: 1, C: 1, ELIMINATED: 0 },
        alerts: { coaching: [{}], improvement: [{}], projects: [{}] },
      },
    }));
    expect(html).toContain('辅导执行异常');
    expect(html).toContain('商家改善异常');
    expect(html).toContain('项目异常');
    expect(html).toContain('/projects?abnormal=true');
    expect(html).toContain('商家结构');
  });
});
