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

export type ProjectListQuery = {
  cursor?: string | null;
  limit?: number;
  abnormal?: boolean;
  alert?: 'COACHING' | 'IMPROVEMENT' | 'ABNORMAL';
  assignedFrom?: Date;
  assignedTo?: Date;
  merchantId?: string;
  coached?: boolean | null;
  improved?: boolean | null;
  source?: SelectableBusinessSource;
  regionId?: string;
  cityId?: string;
};

export type ProjectListItem = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  merchantName: string;
  organizationId: string;
  businessSource: ActualBusinessSource;
  dataDate: string;
  assignedAt: string;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
};

type SourceAwareProjectListQuery = Required<Pick<ProjectListQuery, 'limit'>>
  & ProjectListQuery & { selection: OperationsSelection };
type LegacyProjectQuery = Required<Pick<ProjectListQuery, 'limit'>>
  & ProjectListQuery & { organizationIds: string[] | null };

export type ProjectListRepository = {
  list(query: SourceAwareProjectListQuery): Promise<{
    items: ProjectListItem[]; nextCursor: string | null;
  }>;
};

export type LegacyProjectListRepository = {
  list(query: LegacyProjectQuery): Promise<{
    items: ProjectListItem[]; nextCursor: string | null;
  }>;
};

export type ResolveProjectSelection = (
  filter: OperationsFilter,
  scope: OrganizationScope,
) => Promise<OperationsSelection>;

function operationsFilter(query: ProjectListQuery): OperationsFilter {
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

function projectCursor(item: Pick<ProjectListItem, 'id' | 'businessSource' | 'merchantId'>): string {
  return encodeURIComponent(JSON.stringify([item.id, item.businessSource, item.merchantId]));
}

function cursorValues(cursor: string): [string, string, string] | null {
  try {
    const decoded = JSON.parse(decodeURIComponent(cursor)) as unknown;
    return Array.isArray(decoded) && decoded.length === 3
      && typeof decoded[0] === 'string' && typeof decoded[1] === 'string' && typeof decoded[2] === 'string'
      ? [decoded[0], decoded[1], decoded[2]] : null;
  } catch {
    return null;
  }
}

/**
 * The home-page cards and the project list both use this predicate.  Keeping
 * it in one place prevents a card total from pointing to a different detail
 * result set.
 */
export function matchesProjectListQuery(
  item: Pick<ProjectListItem, 'assignedAt' | 'needsCoaching' | 'coached' | 'improved'>,
  query: ProjectListQuery,
): boolean {
  const assignedAt = new Date(item.assignedAt);
  if (Number.isNaN(assignedAt.getTime())) return false;
  if (query.assignedFrom && assignedAt < query.assignedFrom) return false;
  if (query.assignedTo && assignedAt >= query.assignedTo) return false;

  if (query.alert === 'COACHING') return item.needsCoaching === true && item.coached === null;
  if (query.alert === 'IMPROVEMENT') return item.improved === false;
  if (query.alert === 'ABNORMAL') {
    return item.needsCoaching === true || item.improved === false || item.coached === null;
  }
  if (query.abnormal && !(item.needsCoaching === true || item.improved === false || item.coached === null)) {
    return false;
  }
  if (query.coached !== undefined && item.coached !== query.coached) return false;
  if (query.improved !== undefined && item.improved !== query.improved) return false;
  return true;
}

/**
 * A source project ID is not globally unique: the same ID can occur under
 * different merchants (and, when viewing all data, under different sources).
 * The dashboard and alert detail list must therefore use this same identity.
 */
export function projectAlertIdentityKey(item: Pick<ProjectListItem, 'id' | 'merchantId' | 'businessSource'>): string {
  return `${item.businessSource}:${item.merchantId}:${item.id}`;
}

function uniqueAlertProjects(items: ProjectListItem[], query: ProjectListQuery) {
  if (!query.alert) return items;
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = projectAlertIdentityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function paginateProjectItems(items: ProjectListItem[], query: ProjectListQuery) {
  let filtered = uniqueAlertProjects(items.filter((item) => matchesProjectListQuery(item, query)), query);
  filtered.sort((left, right) => (
    left.id.localeCompare(right.id)
      || left.businessSource.localeCompare(right.businessSource)
      || left.merchantId.localeCompare(right.merchantId)
  ));
  if (query.cursor) {
    const cursor = cursorValues(query.cursor);
    if (cursor) {
      filtered = filtered.filter((item) => (
        item.id > cursor[0]
          || (item.id === cursor[0] && item.businessSource > cursor[1])
          || (item.id === cursor[0] && item.businessSource === cursor[1] && item.merchantId > cursor[2])
      ));
    }
  }
  const limit = query.limit ?? 50;
  const hasMore = filtered.length > limit;
  const page = hasMore ? filtered.slice(0, limit) : filtered;
  return {
    items: page,
    nextCursor: hasMore && page.length > 0 ? projectCursor(page[page.length - 1]!) : null,
  };
}

export const legacyProjectListRepository: LegacyProjectListRepository = {
  async list(query) {
    const rows = await db.project.findMany({
      where: {
        organizationId: query.organizationIds ? { in: query.organizationIds } : undefined,
        merchantId: query.merchantId,
      },
      orderBy: { id: 'asc' },
      include: { merchant: { select: { name: true } } },
    });
    return paginateProjectItems(rows.map((row) => ({
        id: row.id,
        sourceProjectId: row.sourceProjectId,
        merchantId: row.merchantId,
        merchantName: row.merchant.name,
        organizationId: row.organizationId,
        businessSource: 'DESIGNBAO',
        dataDate: row.assignedAt.toISOString().slice(0, 10),
        assignedAt: row.assignedAt.toISOString(),
        needsCoaching: row.needsCoaching,
        coached: row.coached,
        improved: row.improved,
      })), query);
  },
};

export const prismaProjectListRepository: ProjectListRepository = {
  async list(query) {
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (!batch) return { items: [], nextCursor: null };
    const rows = await db.projectSnapshot.findMany({
      where: {
        uploadBatchId: batch.id,
        organizationId: selectedOrganizations(query.selection),
        ...(query.selection.merchantId ? { merchantId: query.selection.merchantId } : {}),
        businessSource: actualSourceWhere(query.selection.source),
      },
      select: {
        projectId: true,
        sourceProjectId: true,
        merchantId: true,
        organizationId: true,
        businessSource: true,
        dataDate: true,
        assignedAt: true,
        needsCoaching: true,
        coached: true,
        improved: true,
        merchant: { select: { name: true } },
      },
    });
    let items = rows.flatMap((row): ProjectListItem[] => (
      row.businessSource === 'DESIGNBAO' || row.businessSource === 'XIAOHONGSHU'
        ? [{
          id: row.projectId,
          sourceProjectId: row.sourceProjectId,
          merchantId: row.merchantId,
          merchantName: row.merchant.name,
          organizationId: row.organizationId,
          businessSource: row.businessSource,
          dataDate: row.dataDate.toISOString().slice(0, 10),
          assignedAt: row.assignedAt.toISOString(),
          needsCoaching: row.needsCoaching,
          coached: row.coached,
          improved: row.improved,
        }]
        : []
    ));
    return paginateProjectItems(items, query);
  },
};

export async function listProjects(
  query: ProjectListQuery,
  scope: OrganizationScope,
  repository: ProjectListRepository = prismaProjectListRepository,
  resolveSelection: ResolveProjectSelection = resolveOperationsSelection,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  const selection = await resolveSelection(operationsFilter(query), scope);
  return repository.list({ ...query, limit, selection });
}

export async function listLegacyProjects(
  query: ProjectListQuery,
  scope: OrganizationScope,
  repository: LegacyProjectListRepository = legacyProjectListRepository,
) {
  const limit = Math.max(1, Math.min(query.limit ?? 50, 200));
  return repository.list({
    ...query,
    limit,
    organizationIds: scope.unrestricted ? null : scope.organizationIds,
  });
}

export async function listProjectsForRollout(
  enabled: boolean,
  query: ProjectListQuery,
  scope: OrganizationScope,
  dependencies: {
    repository?: ProjectListRepository;
    legacyRepository?: LegacyProjectListRepository;
    resolveSelection?: ResolveProjectSelection;
  } = {},
) {
  return enabled
    ? listProjects(query, scope, dependencies.repository, dependencies.resolveSelection)
    : listLegacyProjects(query, scope, dependencies.legacyRepository);
}

export type ProjectDetailData = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  merchantName: string;
  businessSource: ActualBusinessSource;
  dataDate: string;
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
  ruleHits: Array<{ code: string; reason: string }>;
};

export type ProjectDetailRepository = {
  load(id: string, selection: OperationsSelection, dataDate?: string): Promise<ProjectDetailData | null>;
};

export const prismaProjectDetailRepository: ProjectDetailRepository = {
  async load(id, selection, dataDate) {
    const batch = await db.uploadBatch.findFirst({
      where: {
        status: 'SUCCEEDED',
        ...(dataDate ? { dataDate: new Date(`${dataDate}T00:00:00.000Z`) } : {}),
      },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (!batch) return null;
    const snapshot = await db.projectSnapshot.findFirst({
      where: {
        uploadBatchId: batch.id,
        projectId: id,
        organizationId: selectedOrganizations(selection),
        ...(selection.merchantId ? { merchantId: selection.merchantId } : {}),
        businessSource: actualSourceWhere(selection.source),
      },
      select: {
        projectId: true,
        sourceProjectId: true,
        merchantId: true,
        businessSource: true,
        dataDate: true,
        followWithin30m: true,
        needsAnalyzed: true,
        hardInvite: true,
        needsCoaching: true,
        coached: true,
        improved: true,
        merchant: { select: { name: true } },
      },
    });
    if (!snapshot || (snapshot.businessSource !== 'DESIGNBAO' && snapshot.businessSource !== 'XIAOHONGSHU')) {
      return null;
    }
    const ruleHits = await db.ruleHit.findMany({
      where: {
        projectId: id,
        sourceBatchId: batch.id,
        dataDate: snapshot.dataDate,
        businessSource: snapshot.businessSource,
        version: 'v2',
      },
      orderBy: { createdAt: 'desc' },
      select: { code: true, reason: true },
    });
    return {
      id: snapshot.projectId,
      sourceProjectId: snapshot.sourceProjectId,
      merchantId: snapshot.merchantId,
      merchantName: snapshot.merchant.name,
      businessSource: snapshot.businessSource,
      dataDate: snapshot.dataDate.toISOString().slice(0, 10),
      followWithin30m: snapshot.followWithin30m,
      needsAnalyzed: snapshot.needsAnalyzed,
      hardInvite: snapshot.hardInvite,
      needsCoaching: snapshot.needsCoaching,
      coached: snapshot.coached,
      improved: snapshot.improved,
      ruleHits,
    };
  },
};

export async function getProjectDetail(
  id: string,
  filter: OperationsFilter,
  scope: OrganizationScope,
  dataDate?: string,
  repository: ProjectDetailRepository = prismaProjectDetailRepository,
  resolveSelection: ResolveProjectSelection = resolveOperationsSelection,
) {
  const selection = await resolveSelection(filter, scope);
  return repository.load(id, selection, dataDate);
}

export async function getLegacyProjectDetail(id: string, scope: OrganizationScope) {
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

