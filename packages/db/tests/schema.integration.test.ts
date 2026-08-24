import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL('../prisma/migrations/20260821_initial_domain/migration.sql', import.meta.url),
);
const sourceMigrationPath = fileURLToPath(
  new URL(
    '../prisma/migrations/20260823_business_source_operations/migration.sql',
    import.meta.url,
  ),
);
const sourceContractPath = fileURLToPath(
  new URL(
    '../prisma/migrations/20260824_finalize_business_source_operations/migration.sql',
    import.meta.url,
  ),
);
const schemaPath = fileURLToPath(
  new URL('../prisma/schema.prisma', import.meta.url),
);
const migrationSql = await readFile(migrationPath, 'utf8').catch(() => '');
const sourceMigrationSql = await readFile(sourceMigrationPath, 'utf8').catch(() => '');
const sourceContractSql = await readFile(sourceContractPath, 'utf8').catch(() => '');
const schema = await readFile(schemaPath, 'utf8');

function modelSchema(name: string): string {
  return schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
}

async function createExpandedDatabase(): Promise<PGlite> {
  expect(migrationSql, 'the production PostgreSQL migration must exist').not.toBe('');
  expect(sourceMigrationSql, 'the source-aware migration must exist').not.toBe('');
  const database = new PGlite();
  await database.exec(migrationSql);
  await database.exec(sourceMigrationSql);
  return database;
}

async function createDatabase(): Promise<PGlite> {
  const database = await createExpandedDatabase();
  expect(sourceContractSql, 'the source-aware contract migration must exist').not.toBe('');
  await database.exec(sourceContractSql);
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
  it('defines source-aware snapshots, classifications, rule hits and overrides', () => {
    expect(schema).toContain('enum BusinessSource');
    expect(modelSchema('ProjectSnapshot')).toMatch(/businessSource\s+BusinessSource/);
    expect(modelSchema('ProjectSnapshot')).toMatch(/assignedAt\s+DateTime/);
    expect(modelSchema('MetricSnapshot')).toMatch(/businessSource\s+BusinessSource/);
    expect(modelSchema('MerchantClassificationSnapshot')).toMatch(
      /dataAvailable\s+Boolean/,
    );
    expect(modelSchema('MerchantClassificationSnapshot')).toMatch(
      /@@unique\(\[merchantId, dataDate, businessSource\]/,
    );
    expect(modelSchema('RuleHit')).toMatch(/businessSource\s+BusinessSource/);
    expect(modelSchema('RuleHit')).toMatch(
      /@@unique\(\[code, entityType, entityId, dataDate, version, businessSource, sourceBatchId\]/,
    );
    expect(modelSchema('MerchantOverride')).toMatch(/businessSource\s+BusinessSource\?/);
  });

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
        ("id", "dataDate", "businessSource", "assignedAt", "projectId", "sourceProjectId", "merchantId", "organizationId", "uploadBatchId", "status", "raw")
      VALUES
        ('snapshot-1', DATE '2026-08-21', 'DESIGNBAO', NOW(), 'project-1::merchant-1', 'project-1', 'merchant-1', 'city-1', 'batch-1', 'ACTIVE', '{}'::jsonb);
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
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "businessSource", "value", "numerator", "denominator", "source", "sourceBatchId", "formulaVersion")
        VALUES
          ('metric-1', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 'DESIGNBAO', 50, 1, 2, 'CALCULATED', 'batch-1', 'v1'),
          ('metric-2', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 'DESIGNBAO', 75, 3, 4, 'CALCULATED', 'batch-2', 'v1');
    `);

    await expect(database.exec(`
      INSERT INTO "MetricSnapshot"
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "businessSource", "value", "numerator", "denominator", "source", "sourceBatchId", "formulaVersion")
        VALUES ('metric-3', 'project_open_rate', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 'DESIGNBAO', 80, 4, 5, 'CALCULATED', 'batch-2', 'v1');
    `)).rejects.toThrow();
    await database.close();
  });

  it('keeps legacy writers working while Railway rolls the new services out', async () => {
    const database = await createExpandedDatabase();
    await seedProjectDependencies(database);
    await database.exec(`
      INSERT INTO "MetricDefinition"
        ("id", "name", "groupId", "groupName", "unit", "direction", "source", "sortOrder", "updatedAt")
        VALUES ('legacy_metric', '旧版指标', 'legacy', '旧版', 'COUNT', 'POSITIVE', 'CALCULATED', 1, NOW());

      -- These statements intentionally omit every source-aware column. They model
      -- the old web/worker containers that can remain alive during a rolling deploy.
      INSERT INTO "ProjectSnapshot"
        ("id", "dataDate", "projectId", "sourceProjectId", "merchantId", "organizationId", "uploadBatchId", "status", "raw")
        VALUES (
          'legacy-project-snapshot', DATE '2026-08-21', 'project-1::merchant-1',
          'project-1', 'merchant-1', 'city-1', 'batch-1', 'ACTIVE',
          '{"F":"设计宝"}'::jsonb
        );
      INSERT INTO "MetricSnapshot"
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "value", "source", "sourceBatchId", "formulaVersion")
        VALUES (
          'legacy-metric-snapshot', 'legacy_metric', 'DAY', DATE '2026-08-21', DATE '2026-08-21',
          'city-1', 'organization', 1, 'CALCULATED', 'batch-1', 'v1'
        );
      INSERT INTO "MerchantClassificationSnapshot"
        ("id", "merchantId", "dataDate", "classification", "suggested", "reason", "evidence", "ruleVersion", "requiresConfirmation", "effectiveAt")
        VALUES (
          'legacy-classification', 'merchant-1', DATE '2026-08-21', 'B', 'B',
          '旧版写入', '{}'::jsonb, 'v1', FALSE, NOW()
        );
      INSERT INTO "RuleHit"
        ("id", "code", "version", "entityType", "entityId", "merchantId", "dataDate", "status", "evidence", "reason", "sourceBatchId")
        VALUES (
          'legacy-rule-hit', 'legacy-rule', 'v1', 'MERCHANT', 'merchant-1', 'merchant-1',
          DATE '2026-08-21', 'ACTIVE', '{}'::jsonb, '旧版写入', 'batch-1'
        );

      -- Prisma's legacy generated client emits this conflict target for its
      -- merchant/date upsert. It must remain valid during the mixed-version window.
      INSERT INTO "MerchantClassificationSnapshot"
        ("id", "merchantId", "dataDate", "classification", "suggested", "reason", "evidence", "ruleVersion", "requiresConfirmation", "effectiveAt")
        VALUES (
          'legacy-classification-upsert', 'merchant-1', DATE '2026-08-21', 'C', 'C',
          '旧版更新', '{}'::jsonb, 'v1', FALSE, NOW()
        )
        ON CONFLICT ("merchantId", "dataDate") DO UPDATE
        SET "classification" = EXCLUDED."classification", "suggested" = EXCLUDED."suggested";
    `);

    const project = await database.query<{ businessSource: string; assignedAt: Date }>(
      `SELECT "businessSource", "assignedAt" FROM "ProjectSnapshot" WHERE "id" = 'legacy-project-snapshot'`,
    );
    const metric = await database.query<{ businessSource: string }>(
      `SELECT "businessSource" FROM "MetricSnapshot" WHERE "id" = 'legacy-metric-snapshot'`,
    );
    const classification = await database.query<{ businessSource: string }>(
      `SELECT "businessSource" FROM "MerchantClassificationSnapshot" WHERE "id" = 'legacy-classification'`,
    );
    const ruleHit = await database.query<{ businessSource: string }>(
      `SELECT "businessSource" FROM "RuleHit" WHERE "id" = 'legacy-rule-hit'`,
    );

    expect(project.rows[0]?.businessSource).toBe('DESIGNBAO');
    expect(project.rows[0]?.assignedAt).toBeInstanceOf(Date);
    expect(metric.rows[0]?.businessSource).toBe('OTHER');
    expect(classification.rows[0]?.businessSource).toBe('ALL');
    expect(ruleHit.rows[0]?.businessSource).toBe('OTHER');
    const upserted = await database.query<{ classification: string }>(
      `SELECT "classification" FROM "MerchantClassificationSnapshot" WHERE "id" = 'legacy-classification'`,
    );
    expect(upserted.rows[0]?.classification).toBe('C');
    await database.close();
  });

  it('versions corrected rule hits by source batch instead of dropping the new result', async () => {
    const database = await createDatabase();
    await seedProjectDependencies(database);
    await database.exec(`
      INSERT INTO "UploadBatch" ("id", "fileName", "fileHash", "dataDate", "status", "updatedAt")
        VALUES ('batch-2', 'designbao-corrected.xlsx', 'corrected-hash', DATE '2026-08-21', 'SUCCEEDED', NOW());
      INSERT INTO "RuleHit"
        ("id", "code", "version", "entityType", "entityId", "projectId", "merchantId", "dataDate", "businessSource", "status", "evidence", "reason", "sourceBatchId")
        VALUES
          ('hit-1', 'PROJECT_NEEDS_COACHING', 'v2', 'PROJECT', 'project-1::merchant-1', 'project-1::merchant-1', 'merchant-1', DATE '2026-08-21', 'DESIGNBAO', 'ACTIVE', '{}'::jsonb, '原批次', 'batch-1'),
          ('hit-2', 'PROJECT_NEEDS_COACHING', 'v2', 'PROJECT', 'project-1::merchant-1', 'project-1::merchant-1', 'merchant-1', DATE '2026-08-21', 'DESIGNBAO', 'ACTIVE', '{}'::jsonb, '修正版', 'batch-2');
    `);
    const result = await database.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "RuleHit" WHERE "code" = 'PROJECT_NEEDS_COACHING'`,
    );
    expect(result.rows[0]?.count).toBe(2);
    await database.close();
  });

  it('rejects ALL as a stored fact source and inconsistent no-data classifications', async () => {
    const database = await createDatabase();
    await seedProjectDependencies(database);
    await database.exec(`
      INSERT INTO "MetricDefinition"
        ("id", "name", "groupId", "groupName", "unit", "direction", "source", "sortOrder", "updatedAt")
        VALUES ('actual_fact', '实际来源事实', 'source', '来源', 'COUNT', 'POSITIVE', 'CALCULATED', 1, NOW());
    `);
    await expect(database.exec(`
      INSERT INTO "ProjectSnapshot"
        ("id", "dataDate", "businessSource", "assignedAt", "projectId", "sourceProjectId", "merchantId", "organizationId", "uploadBatchId", "status", "raw")
        VALUES ('invalid-all-project', DATE '2026-08-21', 'ALL', NOW(), 'project-1::merchant-1', 'project-1', 'merchant-1', 'city-1', 'batch-1', 'ACTIVE', '{}'::jsonb);
    `)).rejects.toThrow();
    await expect(database.exec(`
      INSERT INTO "MerchantClassificationSnapshot"
        ("id", "merchantId", "dataDate", "businessSource", "dataAvailable", "classification", "suggested", "reason", "evidence", "ruleVersion", "requiresConfirmation", "effectiveAt")
        VALUES ('invalid-available', 'merchant-1', DATE '2026-08-22', 'XIAOHONGSHU', TRUE, NULL, NULL, '不一致', '{}'::jsonb, 'v2', FALSE, NOW());
    `)).rejects.toThrow();
    await expect(database.exec(`
      INSERT INTO "MetricSnapshot"
        ("id", "metricId", "grain", "periodStart", "periodEnd", "organizationId", "dimensionKey", "businessSource", "value", "source", "sourceBatchId", "formulaVersion")
        VALUES ('invalid-all-metric', 'actual_fact', 'DAY', DATE '2026-08-21', DATE '2026-08-21', 'city-1', 'organization', 'ALL', 1, 'CALCULATED', 'batch-1', 'v1');
    `)).rejects.toThrow();
    await expect(database.exec(`
      INSERT INTO "MerchantClassificationSnapshot"
        ("id", "merchantId", "dataDate", "businessSource", "dataAvailable", "classification", "suggested", "reason", "evidence", "ruleVersion", "requiresConfirmation", "effectiveAt")
        VALUES ('invalid-no-data', 'merchant-1', DATE '2026-08-21', 'XIAOHONGSHU', FALSE, 'B', 'B', '不一致', '{}'::jsonb, 'v2', FALSE, NOW());
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
