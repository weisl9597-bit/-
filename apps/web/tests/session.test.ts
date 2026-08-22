import { describe, expect, it } from 'vitest';

describe('session token creation', () => {
  it('returns a random raw token and stores only its SHA-256 hash', async () => {
    const module = await import('../lib/auth/session').catch(() => ({}));
    expect(module).toHaveProperty('createSessionToken');
    expect(module).toHaveProperty('hashSessionToken');

    const { createSessionToken, hashSessionToken } = module as typeof import('../lib/auth/session');
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first.rawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(first.rawToken).not.toBe(second.rawToken);
    expect(first.tokenHash).toBe(hashSessionToken(first.rawToken));
    expect(first.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.tokenHash).not.toContain(first.rawToken);
  });
});
