import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('production application entry page', () => {
  it('identifies the designbao operations workbench', async () => {
    const pageModule = await import('../app/page').catch(() => ({}));
    expect(pageModule).toHaveProperty('default');

    const Page = (pageModule as { default: () => React.ReactNode }).default;
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).toContain('今日需要关注什么');
    expect(html).toContain('加载运营数据');
    expect(html).not.toContain('生产系统建设中');
  });
});
