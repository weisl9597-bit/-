import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../prisma/migrations/20260821_initial_domain/migration.sql', import.meta.url),
);
const migrationSql = await readFile(migrationPath, 'utf8').catch(() => '');

async function createDatabase(): Promise<PGlite> {
  expect(migrationSql, 'the production PostgreSQL migration must exist').not.toBe('');
  const database = new PGlite();
  await database.exec(migrationSql);
  return database;
}

async function seedProjectDependencies(database: PGlite): Promise<void> {
  await database.exec(`
    INSERT INTO "Organization" ("id", "name", "level", "path", "updatedAt")
      VALUES ('city-1', '深圳', 'CITY', '/china/south/shenzhen', NOW());
    INSERT INTO "Merchant" ("id", "name", "organizationId", "active", "updatedAt")
      VALUES ('merchant-1', '城市空间', 'city-1', TRUE, NOW());
    INSERT INTO "Project" ("id", "sourceProjectId", "merchantId", "organizationId", "assignedAt", "status", "updatedAt")
      VALUES ('project-1::merchant-1', 'project-1', 'merchant-1', 'city-1', NOW(), 'ACTIVE', NOW());
    INSERT INTO "UploadBatch" ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
      VALUES ('batch-1', 'designbao.xlsx', 'abc123', DATE '2026-08-21', 'SUCCEEDED', NOW());
  `);
}

describe('production database migration', () => {
  it('allows one source project to be assigned to multiple merchants but rejects the same assignment twice', async () => {
    const database = await createDatabase();
    await database.exec(`
      INSERT INTO "Organization" ("id", "name", "level", "path", "updatedAt")
        VALUES ('city-1', '北京', 'CITY', '/china/north/beijing', NOW());
      INSERT INTO "Merchant" ("id", "name", "organizationId", "active", "updatedAt")
        VALUES
          ('merchant-1', '示例装企一', 'city-1', TRUE, NOW()),
          ('merchant-2', '示例装企二', 'city-1', TRUE, NOW());
      INSERT INTO "Project"
        ("id", "sourceProjectId", "merchantId", "organizationId", "assignedAt", "status", "updatedAt")
        VALUES
          ('P001::merchant-1', 'P001', 'merchant-1', 'city-1', NOW(), 'ACTIVE', NOW()),
          ('P001::merchant-2', 'P001', 'merchant-2', 'city-1', NOW(), 'ACTIVE', NOW());
    `);

    await expect(
      database.exec(`
        INSERT INTO "Project"
          ("id", "sourceProjectId", "merchantId", "organizationId", "assignedAt", "status", "updatedAt")
          VALUES ('another-id', 'P001', 'merchant-1', 'city-1', NOW(), 'ACTIVE', NOW());
      `),
    ).rejects.toThrow();
    await database.close();
  });

  it('rejects duplicate daily snapshots for the same project', async () => {
    const database = await createDatabase();
    await seedProjectDependencies(database);

    const insert = `
      INSERT INTO "ProjectSnapshot"
        ("id", "dataDate", "projectId", "sourceProjectId", "merchantId", "organizationId", "uploadBatchId", "status", "raw")
      VALUES
        ('snapshot-1', DATE '2026-08-21', 'project-1::merchant-1', 'project-1', 'merchant-1', 'city-1', 'batch-1', 'ACTIVE', '{}'::jsonb);
    `;
    await database.exec(insert);

    await expect(database.exec(insert.replace('snapshot-1', 'snapshot-2'))).rejects.toThrow();
    await database.close();
  });

  it('versions corrected metric snapshots by source batch without overwriting history', async () => {
    const database = await createDatabase();
    await seedProjectDependencies(database);
    await database.exec(`
      INSERT INTO "UploadBatch" ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
        VALUES ('batch-2', 'designbao-corrected.xlsx', 'def456', DATE '2026-08-22', 'SUCCEEDED', NOW());
      INSERT INTO "MetricDefinition"
        ("id", "name", "groupId", "groupName", "unit", "direction", "source", "sortOrder", "updatedAt")
        VALUES ('project_open_rate', '开口率', 'dispatch_open', '分派-开口', 'RATE', 'POSITIVE', 'CALCULATED', 1, NOW());
      INSERT INTO "MetricSnapshot"
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "value", "numerator", "denominator", "source", "sourceBatchId", "formulaVersion")
        VALUES
          ('metric-1', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 50, 1, 2, 'CALCULATED', 'batch-1', 'v1'),
          ('metric-2', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 75, 3, 4, 'CALCULATED', 'batch-2', 'v1');
    `);

    await expect(database.exec(`
      INSERT INTO "MetricSnapshot"
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "value", "numerator", "denominator", "source", "sourceBatchId", "formulaVersion")
        VALUES ('metric-3', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 80, 4, 5, 'CALCULATED', 'batch-2', 'v1');
    `)).rejects.toThrow();
    await database.close();
  });

  it('preserves before and after JSON in audit records', async () => {
    const database = await createDatabase();
    await database.exec(`
      INSERT INTO "User" ("id", "email", "passwordHash", "name", "role", "active", "updatedAt")
        VALUES ('user-1', 'admin@example.com', 'hash', '管理员', 'ADMIN', TRUE, NOW());
      INSERT INTO "AuditLog"
        ("id", "actorId", "action", "entityType", "entityId", "reason", "beforeValue", "afterValue")
        VALUES (
          'audit-1', 'user-1', 'CONFIRM_C_CLASS', 'MERCHANT', 'merchant-1', '复核确认',
          '{"classification":"B"}'::jsonb,
          '{"classification":"C"}'::jsonb
        );
    `);

    const result = await database.query<{ beforeValue: { classification: string }; afterValue: { classification: string } }>(
      'SELECT "beforeValue", "afterValue" FROM "AuditLog" WHERE "id" = $1',
      ['audit-1'],
    );
    expect(result.rows[0]).toEqual({
      beforeValue: { classification: 'B' },
      afterValue: { classification: 'C' },
    });
    await database.close();
  });
});
