import { db } from '@designbao/db/client';
import type { OrganizationScope } from '../auth/scope';

export type MerchantListQuery = {
  cursor?: string | null;
  limit?: number;
  search?: string;
  classification?: 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED';
};

export type MerchantListItem = {
  id: string;
  name: string;
  organizationId: string;
  classification: string | null;
  sopRate: number | null;
  projectCount: number;
  lastAssignedAt: string | null;
};

export type MerchantListRepository = {
  list(query: Required<Pick<MerchantListQuery, 'limit'>> & MerchantListQuery & {
    organizationIds: string[] | null;
  }): Promise<{ items: MerchantListItem[]; nextCursor: string | null }>;
};

export const prismaMerchantListRepository: MerchantListRepository = {
  async list(query) {
    const latestClassificationDate = query.classification
      ? (await db.merchantClassificationSnapshot.aggregate({ _max: { dataDate: true } }))._max.dataDate
      : null;
    const rows = await db.merchant.findMany({
      where: {
        id: query.cursor ? { gt: query.cursor } : undefined,
        active: true,
        organizationId: query.organizationIds ? { in: query.organizationIds } : undefined,
        name: query.search ? { contains: query.search, mode: 'insensitive' } : undefined,
        classificationSnapshots: query.classification
          ? { some: { classification: query.classification, dataDate: latestClassificationDate ?? undefined } }
          : undefined,
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
      include: {
        classificationSnapshots: { orderBy: { dataDate: 'desc' }, take: 1 },
        projects: { orderBy: { assignedAt: 'desc' }, take: 1, select: { assignedAt: true } },
        metricSnapshots: {
          where: { metricId: 'merchant_sop_compliance_rate', grain: 'DAY' },
          orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { value: true },
        },
        _count: { select: { projects: true } },
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map((row) => ({
        id: row.id,
        name: row.name,
        organizationId: row.organizationId,
        classification: row.classificationSnapshots[0]?.classification ?? null,
        sopRate: row.metricSnapshots[0]?.value?.toNumber() ?? null,
        projectCount: row._count.projects,
        lastAssignedAt: row.projects[0]?.assignedAt.toISOString() ?? null,
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  },
};

export async function listMerchants(
  query: MerchantListQuery,
  scope: OrganizationScope,
  repository: MerchantListRepository = prismaMerchantListRepository,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  return repository.list({
    ...query,
    limit,
    organizationIds: scope.unrestricted ? null : scope.organizationIds,
  });
}

export async function getMerchantDetail(id: string, scope: OrganizationScope) {
  return db.merchant.findFirst({
    where: {
      id,
      organizationId: scope.unrestricted ? undefined : { in: scope.organizationIds },
    },
    include: {
      organization: true,
      classificationSnapshots: { orderBy: { dataDate: 'desc' }, take: 20 },
      projects: { orderBy: { assignedAt: 'desc' }, take: 50 },
      metricSnapshots: { orderBy: { periodStart: 'desc' }, take: 200 },
      ruleHits: { orderBy: { dataDate: 'desc' }, take: 50 },
    },
  });
}
