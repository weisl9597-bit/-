import { Prisma } from '@prisma/client';

import {
  chunkRows,
  type MerchantWrite,
  type OrganizationWrite,
  type ProjectWrite,
} from './bulk-import-plan';

export type RawQueryExecutor = {
  executeRaw(query: Prisma.Sql): Promise<void>;
};

export async function upsertOrganizations(
  database: RawQueryExecutor,
  rows: OrganizationWrite[],
): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    const values = chunk.map((row) => Prisma.sql`(
      ${row.id},
      ${row.code},
      ${row.name},
      CAST(${row.level} AS "OrganizationLevel"),
      ${row.path},
      ${row.parentId},
      NOW()
    )`);
    await database.executeRaw(Prisma.sql`
      INSERT INTO "Organization"
        ("id", "code", "name", "level", "path", "parentId", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("path") DO UPDATE SET
        "code" = EXCLUDED."code",
        "name" = EXCLUDED."name",
        "level" = EXCLUDED."level",
        "parentId" = EXCLUDED."parentId",
        "updatedAt" = NOW()
    `);
  }
}

export async function upsertMerchants(
  database: RawQueryExecutor,
  rows: MerchantWrite[],
): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    const values = chunk.map((row) => Prisma.sql`(
      ${row.id},
      ${row.name},
      ${row.organizationId},
      ${row.active},
      CAST(${JSON.stringify(row.facts)} AS JSONB),
      NOW()
    )`);
    await database.executeRaw(Prisma.sql`
      INSERT INTO "Merchant"
        ("id", "name", "organizationId", "active", "facts", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name",
        "organizationId" = EXCLUDED."organizationId",
        "updatedAt" = NOW()
    `);
  }
}

export async function upsertProjects(
  database: RawQueryExecutor,
  rows: ProjectWrite[],
): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    const values = chunk.map((row) => Prisma.sql`(
      ${row.id},
      ${row.sourceProjectId},
      ${row.merchantId},
      ${row.organizationId},
      ${row.assignedAt},
      CAST(${row.status} AS "ProjectStatus"),
      ${row.followWithin30m},
      ${row.needsAnalyzed},
      ${row.hardInvite},
      ${row.needsCoaching},
      ${row.coached},
      ${row.improved},
      NOW()
    )`);
    await database.executeRaw(Prisma.sql`
      INSERT INTO "Project"
        (
          "id", "sourceProjectId", "merchantId", "organizationId", "assignedAt",
          "status", "followWithin30m", "needsAnalyzed", "hardInvite",
          "needsCoaching", "coached", "improved", "updatedAt"
        )
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("id") DO UPDATE SET
        "sourceProjectId" = EXCLUDED."sourceProjectId",
        "merchantId" = EXCLUDED."merchantId",
        "organizationId" = EXCLUDED."organizationId",
        "assignedAt" = EXCLUDED."assignedAt",
        "followWithin30m" = EXCLUDED."followWithin30m",
        "needsAnalyzed" = EXCLUDED."needsAnalyzed",
        "hardInvite" = EXCLUDED."hardInvite",
        "needsCoaching" = EXCLUDED."needsCoaching",
        "coached" = EXCLUDED."coached",
        "improved" = EXCLUDED."improved",
        "updatedAt" = NOW()
    `);
  }
}

