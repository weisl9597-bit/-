import { describe, expect, it } from 'vitest';

describe('password protection', () => {
  it('stores an Argon2id hash and verifies only the correct password', async () => {
    const module = await import('../lib/auth/password').catch(() => ({}));
    expect(module).toHaveProperty('hashPassword');
    expect(module).toHaveProperty('verifyPassword');

    const { hashPassword, verifyPassword } = module as typeof import('../lib/auth/password');
    const hash = await hashPassword('Strong-password-2026');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(hash, 'Strong-password-2026')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong-password')).resolves.toBe(false);
  });
});
