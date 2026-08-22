import { createHash, randomBytes, randomUUID } from 'node:crypto';

export type SessionToken = {
  rawToken: string;
  tokenHash: string;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type SessionRepository = {
  create(record: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  deleteById(id: string): Promise<void>;
};

export type SessionManagerOptions = {
  now: () => Date;
  ttlMs: number;
};

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function createSessionToken(): SessionToken {
  const rawToken = randomBytes(32).toString('hex');
  return {
    rawToken,
    tokenHash: hashSessionToken(rawToken),
  };
}

export function createSessionManager(
  repository: SessionRepository,
  options: SessionManagerOptions,
) {
  return {
    async create(userId: string): Promise<SessionToken & { expiresAt: Date }> {
      const token = createSessionToken();
      const expiresAt = new Date(options.now().getTime() + options.ttlMs);
      await repository.create({
        id: randomUUID(),
        userId,
        tokenHash: token.tokenHash,
        expiresAt,
      });
      return { ...token, expiresAt };
    },

    async authenticate(rawToken: string): Promise<SessionRecord | null> {
      const record = await repository.findByTokenHash(hashSessionToken(rawToken));
      if (!record) return null;
      if (record.expiresAt.getTime() <= options.now().getTime()) {
        await repository.deleteById(record.id);
        return null;
      }
      return record;
    },
  };
}
