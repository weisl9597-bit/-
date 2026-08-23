import { db } from '@designbao/db/client';
import type { OrganizationScope } from '../auth/scope';

export type DashboardClassification =
  | 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'C' | 'ELIMINATED';

export type DashboardFacts = {
  dataDate: string | null;
  merchantTotal: number;
  classifications: Array<{ merchantId: string; classification: DashboardClassification }>;
  projects: Array<{
    projectId: string;
    merchantId: string;
    needsCoaching: boolean | null;
    coached: boolean | null;
    improved: boolean | null;
  }>;
};

export type DashboardRepository = {
  load(scope: OrganizationScope): Promise<DashboardFacts>;
};

function organizationWhere(scope: OrganizationScope) {
  return scope.unrestricted ? undefined : { in: scope.organizationIds };
}

export const prismaDashboardRepository: DashboardRepository = {
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
        where: { dataDate: { lte: batch.dataDate }, merchant: { organizationId } },
        orderBy: [{ merchantId: 'asc' }, { dataDate: 'desc' }],
        select: { merchantId: true, classification: true },
      }),
      db.projectSnapshot.findMany({
        where: { uploadBatchId: batch.id, organizationId },
        select: {
          projectId: true, merchantId: true, needsCoaching: true, coached: true, improved: true,
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
      projects,
    };
  },
};

export async function getDashboard(
  scope: OrganizationScope,
  repository: DashboardRepository = prismaDashboardRepository,
) {
  const facts = await repository.load(scope);
  const coaching = facts.projects.filter((project) => project.needsCoaching === true && project.coached === null);
  const improvement = facts.projects.filter((project) => project.improved === false);
  const projects = facts.projects.filter((project) =>
    project.needsCoaching === true || project.improved === false || project.coached === null,
  );
  const merchantStructure = facts.classifications.reduce<Record<DashboardClassification, number>>(
    (counts, item) => ({ ...counts, [item.classification]: counts[item.classification] + 1 }),
    { A: 0, A_RISK: 0, B: 0, C_CANDIDATE: 0, C: 0, ELIMINATED: 0 },
  );
  return {
    dataDate: facts.dataDate,
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

