import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('login page', () => {
  it('collects email and password for the session endpoint', async () => {
    const pageModule = await import('../app/login/page').catch(() => ({}));
    expect(pageModule).toHaveProperty('default');
    const LoginPage = (pageModule as {
      default: (props: { searchParams?: Promise<{ error?: string }> }) => ReactNode | Promise<ReactNode>;
    }).default;
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain('登录设计宝');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('action="/api/session"');
  });

  it('shows a visible message when the submitted credentials are rejected', async () => {
    const { default: LoginPage } = await import('../app/login/page') as {
      default: (props: { searchParams?: Promise<{ error?: string }> }) => ReactNode | Promise<ReactNode>;
    };
    const html = renderToStaticMarkup(await LoginPage({
      searchParams: Promise.resolve({ error: 'invalid_credentials' }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain('邮箱或密码错误');
  });
});
