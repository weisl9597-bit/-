import { createHash } from 'node:crypto';
import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';

export type OrganizationWrite = {
  id: string;
  code: string | null;
  name: string;
  level: 'NATIONAL' | 'REGION' | 'CITY';
  path: string;
  parentId: string | null;
};

export type MerchantWrite = {
  id: string;
  name: string;
  organizationId: string;
  active: boolean;
  facts: Record<string, never>;
};

export type ProjectWrite = {
  id: string;
  sourceProjectId: string;
  merchantId: string;
  organizationId: string;
  assignedAt: Date;
  status: 'UNKNOWN';
  followWithin30m: boolean | null;
  needsAnalyzed: boolean | null;
  hardInvite: boolean | null;
  needsCoaching: boolean | null;
  coached: boolean | null;
  improved: boolean | null;
};

export type BulkImportPlan = {
  organizations: OrganizationWrite[];
  merchants: MerchantWrite[];
  projects: ProjectWrite[];
};

function organizationId(level: 'national' | 'region' | 'city', path: string): string {
  return `org_${level}_${createHash('sha256').update(path).digest('hex').slice(0, 20)}`;
}

export function buildOrganizationPaths(region: string, city: string) {
  const nationalPath = '/china';
  const regionPath = `${nationalPath}/${encodeURIComponent(region)}`;
  return {
    nationalPath,
    regionPath,
    cityPath: `${regionPath}/${encodeURIComponent(city)}`,
  };
}

function dateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function buildBulkImportPlan(records: CanonicalProjectRow[]): BulkImportPlan {
  const organizations = new Map<string, OrganizationWrite>();
  const merchants = new Map<string, MerchantWrite>();
  const projects = new Map<string, ProjectWrite>();
  const nationalPath = '/china';
  const nationalId = organizationId('national', nationalPath);

  organizations.set(nationalPath, {
    id: nationalId,
    code: 'CN',
    name: '全国',
    level: 'NATIONAL',
    path: nationalPath,
    parentId: null,
  });

  for (const record of records) {
    const { regionPath, cityPath } = buildOrganizationPaths(record.region, record.city);
    const regionId = organizationId('region', regionPath);
    const cityId = organizationId('city', cityPath);

    organizations.set(regionPath, {
      id: regionId,
      code: null,
      name: record.region,
      level: 'REGION',
      path: regionPath,
      parentId: nationalId,
    });
    organizations.set(cityPath, {
      id: cityId,
      code: null,
      name: record.city,
      level: 'CITY',
      path: cityPath,
      parentId: regionId,
    });
    merchants.set(record.merchantId, {
      id: record.merchantId,
      name: record.merchantName ?? record.merchantId,
      organizationId: cityId,
      active: true,
      facts: {},
    });
    projects.set(record.assignmentId, {
      id: record.assignmentId,
      sourceProjectId: record.projectId,
      merchantId: record.merchantId,
      organizationId: cityId,
      assignedAt: dateOnly(record.assignedAt),
      status: 'UNKNOWN',
      followWithin30m: record.followWithin30m,
      needsAnalyzed: record.needsAnalyzed,
      hardInvite: record.hardInvite,
      needsCoaching: record.needsCoaching,
      coached: record.coached,
      improved: record.improved,
    });
  }

  return {
    organizations: [...organizations.values()],
    merchants: [...merchants.values()],
    projects: [...projects.values()],
  };
}

export function chunkRows<T>(rows: T[], size = 250): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

