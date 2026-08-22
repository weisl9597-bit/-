import { describe, expect, it } from 'vitest';

describe('session lifecycle', () => {
  it('stores a hash while returning the raw cookie token', async () => {
    const module = await import('../lib/auth/session').catch(() => ({}));
    expect(module).toHaveProperty('createSessionManager');
    const { createSessionManager } = module as typeof import('../lib/auth/session');
    let stored: { id: string; userId: string; tokenHash: string; expiresAt: Date } | undefined;
    const manager = createSessionManager({
      async create(record) {
        stored = record;
      },
      async findByTokenHash() {
        return stored ?? null;
      },
      async deleteById() {
        stored = undefined;
      },
    }, { now: () => new Date('2026-08-21T08:00:00Z'), ttlMs: 60_000 });

    const session = await manager.create('user-1');

    expect(session.rawToken).not.toBe(stored?.tokenHash);
    expect(stored).toMatchObject({ userId: 'user-1', tokenHash: session.tokenHash });
    await expect(manager.authenticate(session.rawToken)).resolves.toMatchObject({ userId: 'user-1' });
  });

  it('rejects and deletes an expired session', async () => {
    const { createSessionManager, hashSessionToken } = await import('../lib/auth/session');
    let deletedId = '';
    const manager = createSessionManager({
      async create() {},
      async findByTokenHash(tokenHash) {
        return {
          id: 'expired-session',
          userId: 'user-1',
          tokenHash,
          expiresAt: new Date('2026-08-20T08:00:00Z'),
        };
      },
      async deleteById(id) {
        deletedId = id;
      },
    }, { now: () => new Date('2026-08-21T08:00:00Z'), ttlMs: 60_000 });

    expect(hashSessionToken('raw')).toHaveLength(64);
    await expect(manager.authenticate('raw')).resolves.toBeNull();
    expect(deletedId).toBe('expired-session');
  });
});
