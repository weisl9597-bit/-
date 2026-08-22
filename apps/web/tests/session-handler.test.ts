import { describe, expect, it } from 'vitest';

describe('session POST handler', () => {
  it('sets a protected session cookie after valid credentials', async () => {
    const module = await import('../lib/auth/session-handler').catch(() => ({}));
    expect(module).toHaveProperty('createSessionHandler');
    const { createSessionHandler } = module as typeof import('../lib/auth/session-handler');
    const handler = createSessionHandler({
      async authenticate(email, password) {
        return email === 'admin@example.com' && password === 'correct' ? { userId: 'user-1' } : null;
      },
      async createSession(userId) {
        expect(userId).toBe('user-1');
        return { rawToken: 'raw-token', expiresAt: new Date('2026-08-22T08:00:00Z') };
      },
    }, { secureCookies: true });
    const request = new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@example.com', password: 'correct' }),
    });

    const response = await handler(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/');
    expect(response.headers.get('set-cookie')).toContain(
      'designbao_session=raw-token; Path=/; Expires=Sat, 22 Aug 2026 08:00:00 GMT; HttpOnly; Secure; SameSite=Lax',
    );
  });

  it('returns to login without creating a session for invalid credentials', async () => {
    const { createSessionHandler } = await import('../lib/auth/session-handler');
    let created = false;
    const handler = createSessionHandler({
      async authenticate() {
        return null;
      },
      async createSession() {
        created = true;
        return { rawToken: 'not-used', expiresAt: new Date() };
      },
    }, { secureCookies: false });
    const request = new Request('http://localhost/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'admin@example.com', password: 'wrong' }),
    });

    const response = await handler(request);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('http://localhost/login?error=invalid_credentials');
    expect(created).toBe(false);
  });
});

describe('current session GET handler', () => {
  it('returns the role used to hide administrator navigation', async () => {
    const { createCurrentSessionHandler } = await import('../lib/auth/session-handler');
    const handler = createCurrentSessionHandler(async () => ({ userId: 'user-1', role: 'ADMIN' }));
    const response = await handler(new Request('http://localhost/api/session'));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ userId: 'user-1', role: 'ADMIN' });
  });
});

describe('session DELETE handler', () => {
  it('revokes the current token and clears the browser cookie', async () => {
    const module = await import('../lib/auth/session-handler').catch(() => ({}));
    expect(module).toHaveProperty('createDeleteSessionHandler');
    const { createDeleteSessionHandler } = module as typeof import('../lib/auth/session-handler');
    let revoked = '';
    const handler = createDeleteSessionHandler(async (token) => { revoked = token; });
    const response = await handler(new Request('https://example.test/api/session', {
      method: 'DELETE', headers: { cookie: 'designbao_session=raw-token' },
    }));
    expect(revoked).toBe('raw-token');
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(response.headers.get('location')).toBe('https://example.test/login');
  });
});
