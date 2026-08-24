import { db } from '@designbao/db/client';
import type { SelectableBusinessSource } from '@designbao/domain/business-source';
import type { OrganizationScope } from '../auth/scope';
import type { OperationsFilter } from './operations-filters';
import {
  resolveOperationsSelection,
  type OperationsSelection,
} from './operations-scope';

export type DashboardClassification =
  | 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED';

export type DashboardFacts = {
  dataDate: string | null;
  merchantTotal: number;
  classifications: Array<{ merchantId: string; classification: DashboardClassification }>;
  projects: Array<{
    projectId: string;
    merchantId: string;
    assignedAt: string;
    needsCoaching: boolean | null;
    coached: boolean | null;
    improved: boolean | null;
  }>;
};

export type DashboardRepository = {
  load(selection: OperationsSelection): Promise<DashboardFacts>;
};

export type LegacyDashboardRepository = {
  load(scope: OrganizationScope): Promise<DashboardFacts>;
};

export type ResolveDashboardSelection = (
  filter: OperationsFilter,
  scope: OrganizationScope,
) => Promise<OperationsSelection>;

function organizationWhere(scope: OrganizationScope) {
  return scope.unrestricted ? undefined : { in: scope.organizationIds };
}

function selectedOrganizations(selection: OperationsSelection) {
  return selection.organizationIds.length === 0 ? undefined : { in: selection.organizationIds };
}

export const legacyDashboardRepository: LegacyDashboardRepository = {
  async load(scope) {
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, dataDate: true },
    });
    if (!batch) {
      return { dataDate: null, merchantTotal: 0, classifications: [], projects: [] };
    }
    const organizationId = organizationWhere(scope);
    const [merchantTotal, classificationRows, projects] = await Promise.all([
      db.merchant.count({ where: { active: true, organizationId } }),
      db.merchantClassificationSnapshot.findMany({
        where: {
          dataDate: { lte: batch.dataDate }, businessSource: 'ALL', merchant: { organizationId },
        },
        orderBy: [{ merchantId: 'asc' }, { dataDate: 'desc' }],
        select: { merchantId: true, classification: true },
      }),
      db.projectSnapshot.findMany({
        where: { uploadBatchId: batch.id, organizationId },
        select: {
          projectId: true, merchantId: true, assignedAt: true,
          needsCoaching: true, coached: true, improved: true,
        },
      }),
    ]);
    const latestByMerchant = new Map<string, DashboardClassification>();
    for (const row of classificationRows) {
      if (row.classification && !latestByMerchant.has(row.merchantId)) {
        latestByMerchant.set(row.merchantId, row.classification);
      }
    }
    return {
      dataDate: batch.dataDate.toISOString().slice(0, 10),
      merchantTotal,
      classifications: [...latestByMerchant].map(([merchantId, classification]) => ({
        merchantId, classification,
      })),
      projects: projects.map((project) => ({
        ...project, assignedAt: project.assignedAt.toISOString(),
      })),
    };
  },
};

export const prismaDashboardRepository: DashboardRepository = {
  async load(selection) {
    const batch = await db.uploadBatch.findFirst({
      where: { status: 'SUCCEEDED' },
      orderBy: [{ dataDate: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, dataDate: true },
    });
    if (!batch) {
      return { dataDate: null, merchantTotal: 0, classifications: [], projects: [] };
    }
    const projects = await db.projectSnapshot.findMany({
      where: {
        uploadBatchId: batch.id,
        organizationId: selectedOrganizations(selection),
        ...(selection.merchantId ? { merchantId: selection.merchantId } : {}),
        businessSource: selection.source === 'ALL'
          ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] }
          : selection.source,
      },
      select: {
        projectId: true, merchantId: true, assignedAt: true,
        needsCoaching: true, coached: true, improved: true,
      },
    });
    const merchantIds = [...new Set(projects.map((project) => project.merchantId))];
    const classificationRows = merchantIds.length === 0 ? []
      : await db.merchantClassificationSnapshot.findMany({
        where: {
          merchantId: { in: merchantIds },
          dataDate: { lte: batch.dataDate },
          businessSource: selection.source,
          dataAvailable: true,
        },
        orderBy: [{ merchantId: 'asc' }, { dataDate: 'desc' }],
        select: { merchantId: true, classification: true },
      });
    const latestByMerchant = new Map<string, DashboardClassification>();
    for (const row of classificationRows) {
      if (row.classification && !latestByMerchant.has(row.merchantId)) {
        latestByMerchant.set(row.merchantId, row.classification);
      }
    }
    return {
      dataDate: batch.dataDate.toISOString().slice(0, 10),
      merchantTotal: merchantIds.length,
      classifications: [...latestByMerchant].map(([merchantId, classification]) => ({
        merchantId, classification,
      })),
      projects: projects.map((project) => ({
        ...project, assignedAt: project.assignedAt.toISOString(),
      })),
    };
  },
};

function projectsAssignedWithinLatest72Hours(facts: DashboardFacts) {
  if (!facts.dataDate) return [];
  const endExclusive = new Date(`${facts.dataDate}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const startInclusive = new Date(endExclusive);
  startInclusive.setUTCDate(startInclusive.getUTCDate() - 3);
  return facts.projects.filter((project) => {
    const assignedAt = new Date(project.assignedAt);
    return !Number.isNaN(assignedAt.getTime())
      && assignedAt >= startInclusive
      && assignedAt < endExclusive;
  });
}

function buildDashboard(facts: DashboardFacts, source: SelectableBusinessSource) {
  const recentProjects = projectsAssignedWithinLatest72Hours(facts);
  const coaching = recentProjects.filter((project) => project.needsCoaching === true && project.coached === null);
  const improvement = recentProjects.filter((project) => project.improved === false);
  const projects = recentProjects.filter((project) =>
    project.needsCoaching === true || project.improved === false || project.coached === null,
  );
  const merchantStructure = facts.classifications.reduce<Record<DashboardClassification, number>>(
    (counts, item) => ({ ...counts, [item.classification]: counts[item.classification] + 1 }),
    { A: 0, A_RISK: 0, B: 0, C_CANDIDATE: 0, C: 0, ELIMINATED: 0 },
  );
  return {
    source,
    dataDate: facts.dataDate,
    hasProjects: facts.projects.length > 0,
    summary: {
      merchantTotal: facts.merchantTotal,
      abnormalProjects: new Set(projects.map((project) => project.projectId)).size,
      coachingDue: coaching.length,
      unimproved: improvement.length,
    },
    merchantStructure,
    alerts: { coaching, improvement, projects },
  };
}

export async function getDashboard(
  filter: OperationsFilter,
  scope: OrganizationScope,
  repository: DashboardRepository = prismaDashboardRepository,
  resolveSelection: ResolveDashboardSelection = resolveOperationsSelection,
) {
  const selection = await resolveSelection(filter, scope);
  return buildDashboard(await repository.load(selection), selection.source);
}

export async function getLegacyDashboard(
  scope: OrganizationScope,
  repository: LegacyDashboardRepository = legacyDashboardRepository,
) {
  return buildDashboard(await repository.load(scope), 'DESIGNBAO');
}

export async function getDashboardForRollout(
  enabled: boolean,
  filter: OperationsFilter,
  scope: OrganizationScope,
  dependencies: {
    repository?: DashboardRepository;
    legacyRepository?: LegacyDashboardRepository;
    resolveSelection?: ResolveDashboardSelection;
  } = {},
) {
  return enabled
    ? getDashboard(filter, scope, dependencies.repository, dependencies.resolveSelection)
    : getLegacyDashboard(scope, dependencies.legacyRepository);
}
