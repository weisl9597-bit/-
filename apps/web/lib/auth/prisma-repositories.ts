import { db } from '@designbao/db/client';
import type { AuthRole, OrganizationScopeRepository } from './scope';
import type { SessionRecord, SessionRepository } from './session';

export const prismaScopeRepository: OrganizationScopeRepository = {
  async findAuthorizationSource(userId) {
    const user = await db.user.findFirst({
      where: { id: userId, active: true },
      select: {
        role: true,
        scopes: { select: { organizationId: true } },
      },
    });
    if (!user) return null;

    const organizations = await db.organization.findMany({
      select: { id: true, path: true },
      orderBy: { path: 'asc' },
    });
    return {
      role: user.role as AuthRole,
      assignedOrganizationIds: user.scopes.map(({ organizationId }) => organizationId),
      organizations,
    };
  },
};

export const prismaSessionRepository: SessionRepository = {
  async create(record) {
    await db.session.create({ data: record });
  },
  async findByTokenHash(tokenHash): Promise<SessionRecord | null> {
    return db.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, tokenHash: true, expiresAt: true },
    });
  },
  async deleteById(id) {
    await db.session.deleteMany({ where: { id } });
  },
};
