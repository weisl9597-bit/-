import { db } from '@designbao/db/client';
import { prismaSessionRepository } from './prisma-repositories';
import { createSessionManager } from './session';

export type RequestActor = {
  userId: string;
  role: 'ADMIN' | 'REGION_MANAGER' | 'CITY_MANAGER';
};

const sessions = createSessionManager(prismaSessionRepository, {
  now: () => new Date(),
  ttlMs: 12 * 60 * 60 * 1000,
});

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

export async function authenticateRequest(request: Request): Promise<RequestActor | null> {
  const token = cookieValue(request, 'designbao_session');
  if (!token) return null;
  const session = await sessions.authenticate(token);
  if (!session) return null;
  const user = await db.user.findFirst({
    where: { id: session.userId, active: true },
    select: { id: true, role: true },
  });
  return user ? { userId: user.id, role: user.role } : null;
}
