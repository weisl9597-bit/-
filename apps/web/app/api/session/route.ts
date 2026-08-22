import { db } from '@designbao/db/client';
import { verifyPassword } from '../../../lib/auth/password';
import { prismaSessionRepository } from '../../../lib/auth/prisma-repositories';
import { createSessionManager } from '../../../lib/auth/session';
import { createDeleteSessionHandler, createSessionHandler } from '../../../lib/auth/session-handler';
import { createCurrentSessionHandler } from '../../../lib/auth/session-handler';
import { authenticateRequest } from '../../../lib/auth/request-actor';
import { hashSessionToken } from '../../../lib/auth/session';

const sessionManager = createSessionManager(prismaSessionRepository, {
  now: () => new Date(),
  ttlMs: 12 * 60 * 60 * 1000,
});

export const POST = createSessionHandler({
  async authenticate(email, password) {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, active: true },
    });
    if (!user?.active) return null;
    return await verifyPassword(user.passwordHash, password) ? { userId: user.id } : null;
  },
  createSession: (userId) => sessionManager.create(userId),
}, { secureCookies: process.env.NODE_ENV === 'production' });

export const GET = createCurrentSessionHandler(authenticateRequest);

export const DELETE = createDeleteSessionHandler(async (rawToken) => {
  await db.session.deleteMany({ where: { tokenHash: hashSessionToken(rawToken) } });
});
