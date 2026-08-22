import { describe, expect, it } from 'vitest';

describe('authentication middleware policy', () => {
  it('allows only login, session creation, health and static assets without a cookie', async () => {
    const module = await import('../lib/auth/middleware-policy').catch(() => ({}));
    expect(module).toHaveProperty('isPublicPath');
    const { isPublicPath } = module as typeof import('../lib/auth/middleware-policy');

    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/api/session')).toBe(true);
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/_next/static/chunk.js')).toBe(true);
    expect(isPublicPath('/metrics')).toBe(false);
    expect(isPublicPath('/api/merchants')).toBe(false);
  });

  it('redirects protected pages and rejects protected APIs without a cookie', async () => {
    const module = await import('../lib/auth/middleware-policy');
    expect(module).toHaveProperty('getAccessDecision');
    const { getAccessDecision } = module as typeof import('../lib/auth/middleware-policy');

    expect(getAccessDecision('/metrics', false)).toEqual({ type: 'redirect', target: '/login?next=%2Fmetrics' });
    expect(getAccessDecision('/api/merchants', false)).toEqual({ type: 'unauthorized' });
    expect(getAccessDecision('/metrics', true)).toEqual({ type: 'allow' });
    expect(getAccessDecision('/login', false)).toEqual({ type: 'allow' });
  });
});
