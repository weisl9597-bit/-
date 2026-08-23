import { db } from '@designbao/db/client';
import type {
  ActualBusinessSource,
  SelectableBusinessSource,
} from '@designbao/domain/business-source';
import type { OrganizationScope } from '../auth/scope';
import type { OperationsFilter } from './operations-filters';
import {
  resolveOperationsSelection,
  type OperationsSelection,
} from './operations-scope';

export type MerchantClassification = 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED';

export type MerchantListQuery = {
  cursor?: string | null;
  limit?: number;
  search?: string;
  classification?: MerchantClassification;
  source?: SelectableBusinessSource;
  regionId?: string;
  cityId?: string;
  merchantId?: string;
};

export type MerchantListItem = {
  id: string;
  name: string;
  organizationId: string;
  classification: MerchantClassification | null;
  dataAvailable: boolean;
  sopRate: number | null;
  projectCount: number;
  lastAssignedAt: string | null;
};

type SourceAwareMerchantListQuery = Required<Pick<MerchantListQuery, 'limit'>>
  & MerchantListQuery & { selection: OperationsSelection };
type LegacyMerchantQuery = Required<Pick<MerchantListQuery, 'limit'>>
  & MerchantListQuery & { organizationIds: string[] | null };

export type MerchantListRepository = {
  list(query: SourceAwareMerchantListQuery): Promise<{
    items: MerchantListItem[]; nextCursor: string | null;
  }>;
};

export type LegacyMerchantListRepository = {
  list(query: LegacyMerchantQuery): Promise<{
    items: MerchantListItem[]; nextCursor: string | null;
  }>;
};

export type ResolveMerchantSelection = (
  filter: OperationsFilter,
  scope: OrganizationScope,
) => Promise<OperationsSelection>;

function operationsFilter(query: MerchantListQuery): OperationsFilter {
  return {
    source: query.source ?? 'DESIGNBAO',
    ...(query.regionId ? { regionId: query.regionId } : {}),
    ...(query.cityId ? { cityId: query.cityId } : {}),
    ...(query.merchantId ? { merchantId: query.merchantId } : {}),
  };
}

function selectedOrganizations(selection: OperationsSelection) {
  return selection.organizationIds.length === 0 ? undefined : { in: selection.organizationIds };
}

function actualSourceWhere(source: SelectableBusinessSource) {
  return source === 'ALL' ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] as ActualBusinessSource[] } : source;
}

export const legacyMerchantListRepository: LegacyMerchantListRepository = {
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
        dataAvailable: true,
        sopRate: row.metricSnapshots[0]?.value?.toNumber() ?? null,
        projectCount: row._count.projects,
        lastAssignedAt: row.projects[0]?.assignedAt.toISOString() ?? null,
      })),
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  },
};

export const prismaMerchantListRepository: MerchantListRepository = {
  async list(query) {
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, dataDate: true },
    });
    if (!batch) return { items: [], nextCursor: null };
    const snapshots = await db.projectSnapshot.findMany({
      where: {
        uploadBatchId: batch.id,
        organizationId: selectedOrganizations(query.selection),
        ...(query.selection.merchantId ? { merchantId: query.selection.merchantId } : {}),
        businessSource: actualSourceWhere(query.selection.source),
      },
      select: {
        merchantId: true,
        assignedAt: true,
        merchant: { select: { name: true, organizationId: true, active: true } },
      },
    });
    const grouped = new Map<string, {
      name: string; organizationId: string; projectCount: number; lastAssignedAt: Date;
    }>();
    for (const snapshot of snapshots) {
      if (!snapshot.merchant.active) continue;
      const current = grouped.get(snapshot.merchantId);
      if (!current) {
        grouped.set(snapshot.merchantId, {
          name: snapshot.merchant.name,
          organizationId: snapshot.merchant.organizationId,
          projectCount: 1,
          lastAssignedAt: snapshot.assignedAt,
        });
      } else {
        current.projectCount += 1;
        if (snapshot.assignedAt > current.lastAssignedAt) current.lastAssignedAt = snapshot.assignedAt;
      }
    }
    const merchantIds = [...grouped.keys()];
    if (merchantIds.length === 0) return { items: [], nextCursor: null };
    const [classificationRows, metricRows] = await Promise.all([
      db.merchantClassificationSnapshot.findMany({
        where: {
          merchantId: { in: merchantIds },
          dataDate: { lte: batch.dataDate },
          businessSource: query.selection.source,
        },
        orderBy: [{ merchantId: 'asc' }, { dataDate: 'desc' }],
        select: {
          merchantId: true, classification: true, dataAvailable: true,
        },
      }),
      db.metricSnapshot.findMany({
        where: {
          sourceBatchId: batch.id,
          metricId: 'merchant_sop_compliance_rate',
          grain: 'DAY',
          merchantId: { in: merchantIds },
          businessSource: query.selection.source,
        },
        orderBy: [{ merchantId: 'asc' }, { periodStart: 'desc' }, { createdAt: 'desc' }],
        select: { merchantId: true, value: true },
      }),
    ]);
    const classifications = new Map<string, {
      classification: MerchantClassification | null; dataAvailable: boolean;
    }>();
    for (const row of classificationRows) {
      if (row.merchantId && !classifications.has(row.merchantId)) {
        classifications.set(row.merchantId, {
          classification: row.classification,
          dataAvailable: row.dataAvailable,
        });
      }
    }
    const sopRates = new Map<string, number | null>();
    for (const row of metricRows) {
      if (row.merchantId && !sopRates.has(row.merchantId)) {
        sopRates.set(row.merchantId, row.value?.toNumber() ?? null);
      }
    }
    let items = merchantIds.map((id): MerchantListItem => {
      const merchant = grouped.get(id)!;
      const classification = classifications.get(id);
      return {
        id,
        name: merchant.name,
        organizationId: merchant.organizationId,
        classification: classification?.classification ?? null,
        dataAvailable: classification?.dataAvailable ?? true,
        sopRate: sopRates.get(id) ?? null,
        projectCount: merchant.projectCount,
        lastAssignedAt: merchant.lastAssignedAt.toISOString(),
      };
    });
    if (query.search) {
      const search = query.search.toLocaleLowerCase('zh-CN');
      items = items.filter((item) => item.name.toLocaleLowerCase('zh-CN').includes(search));
    }
    if (query.classification) {
      items = items.filter((item) => item.classification === query.classification);
    }
    items = items.sort((left, right) => left.id.localeCompare(right.id));
    if (query.cursor) items = items.filter((item) => item.id > query.cursor!);
    const hasMore = items.length > query.limit;
    const page = hasMore ? items.slice(0, query.limit) : items;
    return {
      items: page,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  },
};

export async function listMerchants(
  query: MerchantListQuery,
  scope: OrganizationScope,
  repository: MerchantListRepository = prismaMerchantListRepository,
  resolveSelection: ResolveMerchantSelection = resolveOperationsSelection,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  const selection = await resolveSelection(operationsFilter(query), scope);
  return repository.list({ ...query, limit, selection });
}

export async function listLegacyMerchants(
  query: MerchantListQuery,
  scope: OrganizationScope,
  repository: LegacyMerchantListRepository = legacyMerchantListRepository,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  return repository.list({
    ...query,
    limit,
    organizationIds: scope.unrestricted ? null : scope.organizationIds,
  });
}

export async function listMerchantsForRollout(
  enabled: boolean,
  query: MerchantListQuery,
  scope: OrganizationScope,
  dependencies: {
    repository?: MerchantListRepository;
    legacyRepository?: LegacyMerchantListRepository;
    resolveSelection?: ResolveMerchantSelection;
  } = {},
) {
  return enabled
    ? listMerchants(query, scope, dependencies.repository, dependencies.resolveSelection)
    : listLegacyMerchants(query, scope, dependencies.legacyRepository);
}

export type MerchantDetailData = {
  id: string;
  name: string;
  source: SelectableBusinessSource;
  classification: MerchantClassification | null;
  dataAvailable: boolean;
  reason: string;
  sopRate: number | null;
  projects: Array<{
    id: string; sourceProjectId: string; businessSource: ActualBusinessSource;
  }>;
};

export type MerchantDetailRepository = {
  load(id: string, selection: OperationsSelection): Promise<MerchantDetailData | null>;
};

export const prismaMerchantDetailRepository: MerchantDetailRepository = {
  async load(id, selection) {
    if (selection.merchantId && selection.merchantId !== id) return null;
    const merchant = await db.merchant.findFirst({
      where: {
        id,
        organizationId: selectedOrganizations(selection),
      },
      select: { id: true, name: true },
    });
    if (!merchant) return null;
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, dataDate: true },
    });
    if (!batch) {
      return {
        ...merchant, source: selection.source, classification: null,
        dataAvailable: false, reason: '该来源暂无数据', sopRate: null, projects: [],
      };
    }
    const [projects, classification, metric] = await Promise.all([
      db.projectSnapshot.findMany({
        where: {
          uploadBatchId: batch.id,
          merchantId: id,
          organizationId: selectedOrganizations(selection),
          businessSource: actualSourceWhere(selection.source),
        },
        orderBy: { assignedAt: 'desc' },
        take: 50,
        select: { projectId: true, sourceProjectId: true, businessSource: true },
      }),
      db.merchantClassificationSnapshot.findFirst({
        where: {
          merchantId: id,
          dataDate: { lte: batch.dataDate },
          businessSource: selection.source,
        },
        orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
        select: { classification: true, dataAvailable: true, reason: true },
      }),
      db.metricSnapshot.findFirst({
        where: {
          sourceBatchId: batch.id,
          merchantId: id,
          metricId: 'merchant_sop_compliance_rate',
          grain: 'DAY',
          businessSource: selection.source,
        },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        select: { value: true },
      }),
    ]);
    const dataAvailable = classification?.dataAvailable ?? projects.length > 0;
    return {
      ...merchant,
      source: selection.source,
      classification: classification?.classification ?? null,
      dataAvailable,
      reason: classification?.reason ?? (dataAvailable ? '暂无正式分类原因' : '该来源暂无数据'),
      sopRate: metric?.value?.toNumber() ?? null,
      projects: projects.flatMap((project) => (
        project.businessSource === 'DESIGNBAO' || project.businessSource === 'XIAOHONGSHU'
          ? [{
            id: project.projectId,
            sourceProjectId: project.sourceProjectId,
            businessSource: project.businessSource,
          }]
          : []
      )),
    };
  },
};

export async function getMerchantDetail(
  id: string,
  filter: OperationsFilter,
  scope: OrganizationScope,
  repository: MerchantDetailRepository = prismaMerchantDetailRepository,
  resolveSelection: ResolveMerchantSelection = resolveOperationsSelection,
) {
  const selection = await resolveSelection(filter, scope);
  return repository.load(id, selection);
}

export async function getLegacyMerchantDetail(id: string, scope: OrganizationScope) {
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

