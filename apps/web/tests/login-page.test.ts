import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('login page', () => {
  it('collects email and password for the session endpoint', async () => {
    const pageModule = await import('../app/login/page').catch(() => ({}));
    expect(pageModule).toHaveProperty('default');
    const LoginPage = (pageModule as { default: () => ReactNode }).default;
    const html = renderToStaticMarkup(createElement(LoginPage));

    expect(html).toContain('登录设计宝');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('action="/api/session"');
  });
});
