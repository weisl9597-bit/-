import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MerchantDetail } from '../components/merchants/merchant-detail';
import { ProjectDetail } from '../components/projects/project-detail';
import { UploadResult } from '../components/admin/upload-result';
import { MerchantDecisionPanel } from '../components/admin/merchant-decision-panel';
import { createOperationsFilterController } from '../components/filters/use-operations-filters';

describe('merchant, project and admin UI', () => {
  it('shows classification reason, SOP facts and cross-links', () => {
    const filter = { source: 'XIAOHONGSHU' as const, cityId: 'city-1' };
    const filters = createOperationsFilterController(
      () => filter,
      () => undefined,
      () => undefined,
    );
    const merchant = renderToStaticMarkup(createElement(MerchantDetail, {
      merchant: {
        id: 'M1', name: '示例装企', classification: 'B', reason: '连续两周下降',
        source: 'XIAOHONGSHU', dataAvailable: true,
        sopRate: 48, projects: [{ id: 'P1::M1', sourceProjectId: 'P1', businessSource: 'XIAOHONGSHU' }],
      },
      filters,
    }));
    const project = renderToStaticMarkup(createElement(ProjectDetail, {
      project: {
        id: 'P1::M1', sourceProjectId: 'P1', merchantId: 'M1', merchantName: '示例装企',
        followWithin30m: true, needsAnalyzed: true, hardInvite: false,
        needsCoaching: true, coached: null, improved: false,
      },
    }));
    expect(merchant).toContain('分类原因');
    expect(merchant).toContain('source=XIAOHONGSHU');
    expect(merchant).toContain('merchantId=M1');
    expect(project).toContain('30min内跟进');
    expect(project).toContain('详细需求沟通/户型解析');
    expect(project).toContain('硬约沟通/量房');
    expect(project).toContain('/merchants?id=M1');
  });

  it('distinguishes a source with no merchant data from an unclassified merchant', () => {
    const html = renderToStaticMarkup(createElement(MerchantDetail, {
      merchant: {
        id: 'M1', name: '示例装企', source: 'XIAOHONGSHU',
        classification: null, dataAvailable: false, reason: '该来源暂无数据',
        sopRate: null, projects: [],
      },
    }));
    expect(html).toContain('该来源暂无数据');
    expect(html).not.toContain('未分类');
  });

  it('shows auditable upload counts and blocking status', () => {
    const html = renderToStaticMarkup(createElement(UploadResult, {
      result: { status: 'FAILED', totalRows: 2065, acceptedRows: 0, warningCount: 509, errorCount: 101 },
    }));
    expect(html).toContain('导入未通过');
    expect(html).toContain('101');
    expect(html).toContain('509');
  });

  it('shows skipped-row counts and reasons after a partial successful import', () => {
    const html = renderToStaticMarkup(createElement(UploadResult, {
      result: {
        status: 'SUCCEEDED',
        totalRows: 2115,
        acceptedRows: 1371,
        skippedRows: 744,
        warningCount: 744,
        errorCount: 0,
        issues: [
          {
            code: 'MISSING_ID',
            sourceSheet: '项目明细2',
            sourceRow: 8,
            field: 'projectId',
            message: '项目 ID 不能为空，该行已跳过。',
          },
        ],
      },
    }));

    expect(html).toContain('跳过');
    expect(html).toContain('744');
    expect(html).toContain('第 8 行');
    expect(html).toContain('项目 ID 不能为空，该行已跳过。');
  });

  it('shows the terminal import stage and failure reason', () => {
    const html = renderToStaticMarkup(createElement(UploadResult, {
      result: {
        status: 'FAILED',
        failureStage: 'IMPORT',
        failureMessage: '数据库写入超时',
      },
    }));

    expect(html).toContain('失败原因（IMPORT）');
    expect(html).toContain('数据库写入超时');
  });

  it('requires a reason and exposes candidate confirmation and exemption actions', () => {
    const html = renderToStaticMarkup(createElement(MerchantDecisionPanel, {
      merchantId: 'M1', merchantName: '示例装企', businessSource: 'DESIGNBAO',
      suggested: 'C', reason: '连续两周未改善',
      onSaved: () => undefined,
    }));
    expect(html).toContain('确认进入C类');
    expect(html).toContain('临时豁免');
    expect(html).toContain('操作原因');
    expect(html).toContain('required');
  });
});

