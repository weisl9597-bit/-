import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';
import type { Prisma } from '@prisma/client';
import { PGlite } from '../../../packages/db/node_modules/@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { buildBulkImportPlan } from '../src/jobs/bulk-import-plan';
import {
  upsertMerchants,
  upsertOrganizations,
  upsertProjects,
  type RawQueryExecutor,
} from '../src/jobs/prisma-bulk-upsert';

const migrationSql = await readFile(
  fileURLToPath(
    new URL(
      '../../../packages/db/prisma/migrations/20260821_initial_domain/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

function record(overrides: Partial<CanonicalProjectRow> = {}): CanonicalProjectRow {
  return {
    sourceSheet: '项目明细2',
    sourceRow: 2,
    city: '苏州市',
    cityType: null,
    region: '华东',
    merchantId: 'merchant-1',
    merchantName: "商家'一",
    assignmentId: 'project-1::merchant-1',
    projectId: 'project-1',
    businessSource: 'DESIGNBAO',
    category: null,
    assignedAt: '2026-08-23',
    followWithin30m: true,
    needsAnalyzed: true,
    hardInvite: false,
    needsCoaching: false,
    coached: null,
    improved: null,
    raw: {},
    ...overrides,
  };
}

function executor(database: PGlite): RawQueryExecutor {
  return {
    async executeRaw(query: Prisma.Sql): Promise<void> {
      await database.query(query.text, query.values);
    },
  };
}

describe('parameterized bulk upserts', () => {
  it('inserts and updates organizations, merchants and projects through PostgreSQL', async () => {
    const database = new PGlite();
    await database.exec(migrationSql);
    const first = buildBulkImportPlan([record()]);
    const writer = executor(database);

    await upsertOrganizations(writer, first.organizations);
    await upsertMerchants(writer, first.merchants);
    await upsertProjects(writer, first.projects);

    const corrected = buildBulkImportPlan([
      record({
        merchantName: '修正后的商家',
        followWithin30m: false,
        improved: true,
      }),
    ]);
    await upsertOrganizations(writer, corrected.organizations);
    await upsertMerchants(writer, corrected.merchants);
    await upsertProjects(writer, corrected.projects);

    const organizations = await database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM "Organization"',
    );
    const merchants = await database.query<{ name: string }>(
      'SELECT "name" FROM "Merchant" WHERE "id" = $1',
      ['merchant-1'],
    );
    const projects = await database.query<{
      followWithin30m: boolean;
      improved: boolean;
    }>(
      'SELECT "followWithin30m", "improved" FROM "Project" WHERE "id" = $1',
      ['project-1::merchant-1'],
    );

    expect(organizations.rows[0]?.count).toBe(3);
    expect(merchants.rows[0]?.name).toBe('修正后的商家');
    expect(projects.rows[0]).toEqual({ followWithin30m: false, improved: true });
    await database.close();
  });
});

