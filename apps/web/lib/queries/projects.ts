import { db } from '@designbao/db/client';
import type { OrganizationScope } from '../auth/scope';

export type ProjectListQuery = {
  cursor?: string | null;
  limit?: number;
  abnormal?: boolean;
  merchantId?: string;
  coached?: boolean | null;
  improved?: boolean | null;
};

export type ProjectListItem = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  organizationId: string;
  assignedAt: string;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
};

export type ProjectListRepository = {
  list(query: Required<Pick<ProjectListQuery, 'limit'>> & ProjectListQuery & {
    organizationIds: string[] | null;
  }): Promise<{ items: ProjectListItem[]; nextCursor: string | null }>;
};

export const prismaProjectListRepository: ProjectListRepository = {
  async list(query) {
    const rows = await db.project.findMany({
      where: {
        id: query.cursor ? { gt: query.cursor } : undefined,
        organizationId: query.organizationIds ? { in: query.organizationIds } : undefined,
        merchantId: query.merchantId,
        coached: query.coached,
        improved: query.improved,
        OR: query.abnormal
          ? [{ needsCoaching: true }, { improved: false }, { coached: null }]
          : undefined,
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        sourceProjectId: row.sourceProjectId,
        merchantId: row.merchantId,
        organizationId: row.organizationId,
        assignedAt: row.assignedAt.toISOString(),
        needsCoaching: row.needsCoaching,
        coached: row.coached,
        improved: row.improved,
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  },
};

export async function listProjects(
  query: ProjectListQuery,
  scope: OrganizationScope,
  repository: ProjectListRepository = prismaProjectListRepository,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  return repository.list({
    ...query,
    limit,
    organizationIds: scope.unrestricted ? null : scope.organizationIds,
  });
}

export async function getProjectDetail(id: string, scope: OrganizationScope) {
  return db.project.findFirst({
    where: {
      id,
      organizationId: scope.unrestricted ? undefined : { in: scope.organizationIds },
    },
    include: {
      merchant: { include: { classificationSnapshots: { orderBy: { dataDate: 'desc' }, take: 1 } } },
      organization: true,
      snapshots: { orderBy: { dataDate: 'desc' }, take: 30 },
      ruleHits: { orderBy: { dataDate: 'desc' }, take: 30 },
    },
  });
}
