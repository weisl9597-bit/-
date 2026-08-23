# Bulk Import Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace thousands of sequential import writes with bounded bulk upserts, close the Worker failure loop, and restore the latest upload after a page refresh.

**Architecture:** The Worker will convert validated rows into a deterministic, deduplicated write plan and persist that plan through parameterized PostgreSQL bulk upserts inside the existing atomic transaction. Job exhaustion will mark the related upload batch failed and emit structured logs; the Web API and upload client will expose and restore the latest batch state.

**Tech Stack:** TypeScript 5.9, Node.js 22, Next.js 15, React 19, Prisma 6, PostgreSQL/PGlite, Vitest 3, Railway, GitHub.

**Spec:** `docs/superpowers/specs/2026-08-23-bulk-import-reliability-design.md`

## Global Constraints

- Continue reading only the workbook sheets `项目明细2` and `工作表3`.
- Preserve the verified result for the supplied workbook: 2,026 accepted rows and 89 skipped rows.
- Do not change metric formulas, merchant classification rules, or project alert rules.
- Use parameterized Prisma SQL; never concatenate workbook values into SQL strings.
- Write at most 250 entities per bulk statement.
- Keep one atomic import transaction with a 120-second timeout.
- Do not add another queue, database, cache, or storage service.
- A production import must reach `SUCCEEDED` or `FAILED` within five minutes.
- The workspace mirror has no local `.git`; create one atomic GitHub commit per completed task through the GitHub connector, based on the latest `main` commit.
- Follow TDD for every behavior change: test fails for the intended reason, minimal implementation, focused test passes, then regression tests pass.

---

## File Structure

- Create `apps/worker/src/jobs/bulk-import-plan.ts`: deterministic deduplication, organization IDs, and chunking.
- Create `apps/worker/src/jobs/prisma-bulk-upsert.ts`: parameterized bulk upsert statements for organizations, merchants, and projects.
- Modify `apps/worker/src/jobs/prisma-import-repository.ts`: expose an injectable repository factory and use the plan and bulk writers inside the existing transaction.
- Modify `packages/db/src/jobs.ts`: propagate exhausted IMPORT failures to `UploadBatch`.
- Create `apps/worker/src/job-log.ts`: format structured, secret-safe Worker lifecycle events.
- Modify `apps/worker/src/worker.ts`: structured job lifecycle and error logs.
- Modify `apps/web/lib/uploads/upload-handler.ts`: expose safe failure fields and a latest-upload handler.
- Modify `apps/web/lib/uploads/prisma-upload-dependencies.ts`: map failure fields and load the latest batch.
- Modify `apps/web/app/api/admin/uploads/route.ts`: add authenticated `GET` for the latest batch.
- Modify `apps/web/components/admin/upload-client.tsx`: restore and poll the latest batch after refresh.
- Modify `apps/web/components/admin/upload-result.tsx`: show safe failure details.
- Modify `apps/web/app/styles.css`: style the failure block consistently with the upload result.
- Create or modify focused tests beside the existing Worker, database, API, and UI tests.

---

### Task 1: Deterministic Bulk Import Plan

**Files:**
- Create: `apps/worker/src/jobs/bulk-import-plan.ts`
- Create: `apps/worker/tests/bulk-import-plan.test.ts`

**Interfaces:**
- Consumes: `CanonicalProjectRow` from `@designbao/importer/validate-batch`.
- Produces: `buildBulkImportPlan(records: CanonicalProjectRow[]): BulkImportPlan`.
- Produces: `chunkRows<T>(rows: T[], size?: number): T[][]` with a default size of 250.
- Produces: `BulkImportPlan` containing `national`, `regions`, `cities`, `merchants`, and `projects` arrays.

- [ ] **Step 1: Write failing deduplication and chunking tests**

```ts
import { describe, expect, it } from 'vitest';
import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';
import { buildBulkImportPlan, chunkRows } from '../src/jobs/bulk-import-plan';

function row(overrides: Partial<CanonicalProjectRow>): CanonicalProjectRow {
  return {
    sourceSheet: '项目明细2', sourceRow: 2, assignmentId: 'A1', projectId: 'P1',
    merchantId: 'M1', merchantName: '商家一', region: '华南大区', city: '佛山', cityType: null,
    category: null,
    assignedAt: '2026-08-23', followWithin30m: true, needsAnalyzed: true,
    hardInvite: false, needsCoaching: false, coached: null, improved: null, raw: {},
    ...overrides,
  };
}

describe('bulk import plan', () => {
  it('deduplicates organizations and keeps the last merchant and project values', () => {
    const plan = buildBulkImportPlan([
      row({ merchantName: '旧名称' }),
      row({ sourceRow: 3, merchantName: '新名称', followWithin30m: false }),
      row({ sourceRow: 4, assignmentId: 'A2', projectId: 'P2' }),
    ]);
    expect(plan.regions).toHaveLength(1);
    expect(plan.cities).toHaveLength(1);
    expect(plan.merchants).toHaveLength(1);
    expect(plan.merchants[0]?.name).toBe('新名称');
    expect(plan.projects).toHaveLength(2);
    expect(plan.projects.find((item) => item.id === 'A1')?.followWithin30m).toBe(false);
  });

  it('creates chunks no larger than 250 rows', () => {
    expect(chunkRows(Array.from({ length: 501 }, (_, index) => index)).map((part) => part.length))
      .toEqual([250, 250, 1]);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/worker/tests/bulk-import-plan.test.ts'
```

Expected: FAIL because `bulk-import-plan.ts` does not exist.

- [ ] **Step 3: Implement the minimal plan builder**

```ts
import { createHash } from 'node:crypto';
import type { CanonicalProjectRow } from '@designbao/importer/validate-batch';

export const BULK_CHUNK_SIZE = 250;

export type OrganizationWrite = {
  id: string; code: string | null; name: string; level: 'NATIONAL' | 'REGION' | 'CITY';
  path: string; parentId: string | null;
};
export type MerchantWrite = { id: string; name: string; organizationId: string };
export type ProjectWrite = CanonicalProjectRow & { id: string; organizationId: string };
export type BulkImportPlan = {
  national: OrganizationWrite[]; regions: OrganizationWrite[]; cities: OrganizationWrite[];
  merchants: MerchantWrite[]; projects: ProjectWrite[];
};

function organizationId(level: 'national' | 'region' | 'city', path: string): string {
  return `org_${level}_${createHash('sha256').update(path).digest('hex').slice(0, 20)}`;
}

export function chunkRows<T>(rows: T[], size = BULK_CHUNK_SIZE): T[][] {
  if (!Number.isInteger(size) || size < 1 || size > BULK_CHUNK_SIZE) {
    throw new Error(`Chunk size must be between 1 and ${BULK_CHUNK_SIZE}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

export function buildBulkImportPlan(records: CanonicalProjectRow[]): BulkImportPlan {
  const nationalPath = '/china';
  const nationalId = organizationId('national', nationalPath);
  const regions = new Map<string, OrganizationWrite>();
  const cities = new Map<string, OrganizationWrite>();
  const merchants = new Map<string, MerchantWrite>();
  const projects = new Map<string, ProjectWrite>();
  for (const record of records) {
    const regionPath = `${nationalPath}/${encodeURIComponent(record.region)}`;
    const cityPath = `${regionPath}/${encodeURIComponent(record.city)}`;
    const regionId = organizationId('region', regionPath);
    const cityId = organizationId('city', cityPath);
    regions.set(regionPath, { id: regionId, code: null, name: record.region, level: 'REGION', path: regionPath, parentId: nationalId });
    cities.set(cityPath, { id: cityId, code: null, name: record.city, level: 'CITY', path: cityPath, parentId: regionId });
    merchants.set(record.merchantId, { id: record.merchantId, name: record.merchantName ?? record.merchantId, organizationId: cityId });
    projects.set(record.assignmentId, { ...record, id: record.assignmentId, organizationId: cityId });
  }
  return {
    national: [{ id: nationalId, code: 'CN', name: '全国', level: 'NATIONAL', path: nationalPath, parentId: null }],
    regions: [...regions.values()], cities: [...cities.values()],
    merchants: [...merchants.values()], projects: [...projects.values()],
  };
}
```

- [ ] **Step 4: Run focused and Worker regression tests**

Run the focused command from Step 2, then:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/worker/tests'
```

Expected: all tests PASS.

- [ ] **Step 5: Create the Task 1 GitHub commit**

Create blobs for the two Task 1 files, create a tree from the latest `main` tree, create commit `feat: plan bulk import writes`, and fast-forward `main` without force.

---

### Task 2: Parameterized PostgreSQL Bulk Upserts

**Files:**
- Create: `apps/worker/src/jobs/prisma-bulk-upsert.ts`
- Create: `apps/worker/tests/prisma-bulk-upsert.test.ts`

**Interfaces:**
- Consumes: `OrganizationWrite`, `MerchantWrite`, `ProjectWrite`, and `chunkRows` from Task 1.
- Produces: `upsertOrganizations(executor, rows): Promise<void>`.
- Produces: `upsertMerchants(executor, rows): Promise<void>`.
- Produces: `upsertProjects(executor, rows): Promise<void>`.
- `executor` exposes `$executeRaw(query: Prisma.Sql): Promise<unknown>`.

- [ ] **Step 1: Write failing integration tests against PGlite**

Create a PGlite database from the production migration, adapt `Prisma.Sql.text` and `.values` to `database.query`, execute each bulk helper twice with changed values, and assert:

```ts
expect((await database.query('SELECT COUNT(*)::int AS count FROM "Organization"')).rows[0]?.count).toBe(3);
expect((await database.query<{ name: string }>('SELECT "name" FROM "Merchant" WHERE "id" = $1', ['M1'])).rows[0]?.name).toBe('更新后的商家');
expect((await database.query<{ followWithin30m: boolean }>('SELECT "followWithin30m" FROM "Project" WHERE "id" = $1', ['A1'])).rows[0]?.followWithin30m).toBe(false);
```

The fixture must insert one national organization, one region, one city, one merchant, and one project through the new helpers, then rerun the same helpers with updated merchant/project values.

- [ ] **Step 2: Run the integration test and verify RED**

Run:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/worker/tests/prisma-bulk-upsert.test.ts'
```

Expected: FAIL because the bulk helper module does not exist.

- [ ] **Step 3: Implement organization and merchant bulk statements**

Use the following pattern for every chunk:

```ts
import { Prisma } from '@prisma/client';
import { chunkRows, type MerchantWrite, type OrganizationWrite, type ProjectWrite } from './bulk-import-plan';

export type SqlExecutor = { $executeRaw(query: Prisma.Sql): Promise<unknown> };

export async function upsertOrganizations(executor: SqlExecutor, rows: OrganizationWrite[]): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    const values = chunk.map((row) => Prisma.sql`(${row.id}, ${row.code}, ${row.name}, ${row.level}::"OrganizationLevel", ${row.path}, ${row.parentId}, NOW())`);
    await executor.$executeRaw(Prisma.sql`
      INSERT INTO "Organization" ("id", "code", "name", "level", "path", "parentId", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("path") DO UPDATE SET
        "code" = EXCLUDED."code", "name" = EXCLUDED."name", "level" = EXCLUDED."level",
        "parentId" = EXCLUDED."parentId", "updatedAt" = NOW()
    `);
  }
}

export async function upsertMerchants(executor: SqlExecutor, rows: MerchantWrite[]): Promise<void> {
  for (const chunk of chunkRows(rows)) {
    const values = chunk.map((row) => Prisma.sql`(${row.id}, ${row.name}, ${row.organizationId}, TRUE, '{}'::jsonb, NOW())`);
    await executor.$executeRaw(Prisma.sql`
      INSERT INTO "Merchant" ("id", "name", "organizationId", "active", "facts", "updatedAt")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("id") DO UPDATE SET
        "name" = EXCLUDED."name", "organizationId" = EXCLUDED."organizationId",
        "active" = TRUE, "updatedAt" = NOW()
    `);
  }
}
```

- [ ] **Step 4: Implement the project bulk statement**

Map every `ProjectWrite` to the existing `Project` columns, cast the status literal to `ProjectStatus`, and use `ON CONFLICT ("id") DO UPDATE` for all mutable project fields. Convert `assignedAt` with `${new Date(`${row.assignedAt}T00:00:00.000Z`)}` and pass nullable booleans as parameters.

The insert must include these columns exactly:

```ts
const projectColumns = [
  'id', 'sourceProjectId', 'merchantId', 'organizationId', 'assignedAt', 'status',
  'followWithin30m', 'needsAnalyzed', 'hardInvite', 'needsCoaching', 'coached',
  'improved', 'updatedAt',
];
```

Do not turn `projectColumns` into dynamic SQL; it documents the fixed column order used by the parameterized statement.

- [ ] **Step 5: Run the focused test and all Worker tests**

Run the commands from Task 1 Step 4.

Expected: all tests PASS and the PGlite assertions prove insert and update behavior.

- [ ] **Step 6: Create the Task 2 GitHub commit**

Commit the two Task 2 files as `feat: add parameterized bulk upserts` and fast-forward `main`.

---

### Task 3: Replace Sequential Import Writes

**Files:**
- Modify: `apps/worker/src/jobs/prisma-import-repository.ts`
- Create: `apps/worker/tests/prisma-import-repository.test.ts`
- Modify: `apps/worker/tests/import-batch.integration.test.ts`
- Modify: `packages/importer/tests/real-workbook.acceptance.test.ts`

**Interfaces:**
- Consumes: `buildBulkImportPlan` from Task 1.
- Consumes: `upsertOrganizations`, `upsertMerchants`, and `upsertProjects` from Task 2.
- Produces: `createPrismaImportRepository(database): ImportBatchRepository` for production and isolated tests.
- Preserves: `prismaImportRepository: ImportBatchRepository`.

- [ ] **Step 1: Add a failing repository behavior test**

Create an injected database fake whose `$transaction` supplies `$executeRaw`, `uploadRow`, `uploadError`, `projectSnapshot`, `job`, and `uploadBatch` methods. Call `createPrismaImportRepository(fakeDatabase).persistSuccessful(...)` with two records in the same city and merchant. Assert that the transaction uses bulk SQL and never requires per-row Prisma delegates:

```ts
expect(transaction.$executeRaw).toHaveBeenCalled();
expect(transaction.merchant).toBeUndefined();
expect(transaction.project).toBeUndefined();
expect(transaction.organization).toBeUndefined();
expect(transaction.projectSnapshot.createMany).toHaveBeenCalledOnce();
expect(transaction.uploadBatch.update).toHaveBeenCalledWith(expect.objectContaining({
  data: expect.objectContaining({ status: 'SUCCEEDED', acceptedRows: 2 }),
}));
```

Extend the import integration fixture so a successful import contains two records in the same city and merchant. Assert that the repository-facing result still reports both accepted records and that a repeated invocation returns `SUCCEEDED` without creating another logical project snapshot.

Also export and test a small counter from the bulk plan fixture:

```ts
const plan = buildBulkImportPlan(records);
expect(plan.regions).toHaveLength(1);
expect(plan.cities).toHaveLength(1);
expect(plan.merchants).toHaveLength(1);
expect(plan.projects).toHaveLength(2);
```

- [ ] **Step 2: Run Worker and real-workbook tests and verify RED**

Run:

```powershell
$env:DESIGNBAO_SOURCE_XLSX='C:\Users\Administrator\Desktop\非深圳【设计宝、小红书】.xlsx'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/worker/tests/import-batch.integration.test.ts' 'packages/importer/tests/real-workbook.acceptance.test.ts'
Remove-Item Env:DESIGNBAO_SOURCE_XLSX
```

Expected: FAIL because `createPrismaImportRepository` is not exported and the production repository still requires per-row delegates; the real workbook test continues to document 2,026 accepted and 89 skipped.

- [ ] **Step 3: Replace the two sequential loops in `persistSuccessful`**

Wrap the repository object in `createPrismaImportRepository(database)` and keep `prismaImportRepository = createPrismaImportRepository(db)` as the production export. At the start of the transaction, build the plan once and execute the dependency order explicitly:

```ts
const plan = buildBulkImportPlan(input.records);
await upsertOrganizations(transaction, plan.national);
await upsertOrganizations(transaction, plan.regions);
await upsertOrganizations(transaction, plan.cities);
await upsertMerchants(transaction, plan.merchants);
await upsertProjects(transaction, plan.projects);
```

Delete the per-record `organization.upsert`, `merchant.upsert`, and `project.upsert` loops. Keep raw rows, warnings, snapshots, downstream jobs, and the final `UploadBatch` update inside the same transaction. Build `cityIds` from `plan.cities` by city name for the existing snapshot `createMany` call.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2.

Expected: PASS with 2,026 accepted and 89 skipped for the supplied workbook.

- [ ] **Step 5: Run Worker and importer regression suites**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/worker/tests' 'packages/importer/tests'
```

Expected: all tests PASS, except the real-workbook test is skipped when its environment variable is absent.

- [ ] **Step 6: Create the Task 3 GitHub commit**

Commit the four Task 3 files as `perf: persist imports in bulk` and fast-forward `main`.

---

### Task 4: Close the Worker Failure Loop

**Files:**
- Modify: `packages/db/src/jobs.ts`
- Modify: `packages/db/tests/jobs.integration.test.ts`
- Create: `apps/worker/src/job-log.ts`
- Modify: `apps/worker/src/worker.ts`
- Create: `apps/worker/tests/job-log.test.ts`
- Modify: `apps/worker/tests/job-runner.test.ts`

**Interfaces:**
- Produces: `failJobWithDatabase(jobId, error, database, now): Promise<{ exhausted: boolean; batchId: string | null }>`.
- Produces: `failJob(jobId, error): Promise<{ exhausted: boolean; batchId: string | null }>` as the production wrapper.
- Produces: `formatJobLog(event, job, extra?): string` without credentials or full stack traces.
- Logs one JSON object per claimed, succeeded, retried, or exhausted job.

- [ ] **Step 1: Write a failing exhausted-import test**

Seed PGlite with an `UploadBatch` in `PROCESSING` and an IMPORT Job in `RUNNING` where `attempts = maxAttempts`. Call `failJobWithDatabase` and assert:

```ts
expect(result).toEqual({ exhausted: true, batchId: 'batch-1' });
expect(job.rows[0]).toMatchObject({ status: 'FAILED', lockedBy: null });
expect(batch.rows[0]).toMatchObject({ status: 'FAILED', failureStage: 'WORKER' });
expect(batch.rows[0]?.failureMessage).toContain('database timeout');
```

Add a second test with `attempts < maxAttempts` and assert the Job returns to `QUEUED` while the batch remains `PROCESSING`.

- [ ] **Step 2: Run database tests and verify RED**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'packages/db/tests/jobs.integration.test.ts'
```

Expected: FAIL because `failJobWithDatabase` is not exported and the batch is not updated.

- [ ] **Step 3: Implement failure propagation transactionally**

Inside `failJobWithDatabase`, lock the Job row, compute exhaustion, update the Job, and when the exhausted Job is IMPORT with a source batch execute:

```sql
UPDATE "UploadBatch"
SET "status" = 'FAILED',
    "failureStage" = 'WORKER',
    "failureMessage" = $1,
    "finishedAt" = $2,
    "updatedAt" = $2
WHERE "id" = $3
  AND "status" <> 'SUCCEEDED'
```

Limit the safe message to 500 characters and replace connection URLs, passwords, and access-key-shaped values with `[REDACTED]`. Return `{ exhausted, batchId }` so the Worker can log the outcome.

- [ ] **Step 4: Write a failing structured-log test**

```ts
const output = formatJobLog('job.failed', claimedJob, {
  errorName: 'Error', errorMessage: 'database timeout', exhausted: true,
});
expect(JSON.parse(output)).toMatchObject({
  event: 'job.failed', jobId: 'job-1', batchId: 'batch-1', jobType: 'IMPORT',
  attempt: 3, maxAttempts: 3, exhausted: true,
});
expect(output).not.toContain('DATABASE_URL');
expect(output).not.toContain('postgresql://');
```

Run `apps/worker/tests/job-log.test.ts` and verify it fails because `job-log.ts` does not exist.

- [ ] **Step 5: Add structured Worker logs**

Implement the formatter in `job-log.ts`:

```ts
export function formatJobLog(event: string, job: ClaimedJob, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event, jobId: job.id, batchId: job.sourceBatchId, jobType: job.type,
    attempt: job.attempts, maxAttempts: job.maxAttempts, ...extra,
  });
}
```

In `worker.ts`, write `job.claimed` and `job.succeeded` with `console.log`. After `const failure = await failJob(job.id, error)`, write `job.failed` with `console.error`, including `failure.exhausted`. For a caught error, pass only the error name and safe message; do not log environment variables or object-storage credentials.

- [ ] **Step 6: Run database and Worker tests**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'packages/db/tests/jobs.integration.test.ts' 'apps/worker/tests'
```

Expected: all tests PASS.

- [ ] **Step 7: Create the Task 4 GitHub commit**

Commit the six Task 4 files as `fix: surface exhausted import failures` and fast-forward `main`.

---

### Task 5: Latest Upload and Safe Failure API

**Files:**
- Modify: `apps/web/lib/uploads/upload-handler.ts`
- Modify: `apps/web/lib/uploads/prisma-upload-dependencies.ts`
- Modify: `apps/web/app/api/admin/uploads/route.ts`
- Modify: `apps/web/tests/upload-api.integration.test.ts`

**Interfaces:**
- Extends `UploadRecord` with `failureStage?: string | null` and `failureMessage?: string | null`.
- Extends `UploadStatusDependencies` with `findLatest(): Promise<UploadRecord | null>`.
- Produces: `createLatestUploadHandler(dependencies): (request: Request) => Promise<Response>`.
- Route exports authenticated `GET` and existing `POST`.

- [ ] **Step 1: Write failing latest-upload API tests**

Test these exact cases:

```ts
expect((await latestAdminResponse.json()).id).toBe('batch-latest');
expect(latestAdminResponse.status).toBe(200);
expect(noBatchResponse.status).toBe(204);
expect(unauthenticatedResponse.status).toBe(401);
expect(forbiddenResponse.status).toBe(403);
```

For a failed record, assert the response contains `failureStage: 'WORKER'` and a redacted `failureMessage` but does not contain `postgresql://`, `OBJECT_STORAGE_SECRET_KEY`, or the stored password fixture.

- [ ] **Step 2: Run the API test and verify RED**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/web/tests/upload-api.integration.test.ts'
```

Expected: FAIL because the latest-upload handler and dependency method do not exist.

- [ ] **Step 3: Implement latest-upload mapping and query**

Add failure fields to `mapBatch`. Implement `findLatest` using:

```ts
return db.uploadBatch.findFirst({
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  include: {
    errors: {
      where: { code: { in: ['MISSING_ID', 'UNKNOWN_ORGANIZATION'] } },
      orderBy: [{ sourceSheet: 'asc' }, { sourceRow: 'asc' }],
      take: 50,
    },
  },
});
```

Map the result through the same safe `UploadRecord` mapper used by the detail endpoint.

- [ ] **Step 4: Implement authenticated `GET /api/admin/uploads`**

The handler must authorize ADMIN, return the record with status 200, or return an empty response with status 204 when no batch exists. Export it from the route beside POST:

```ts
export const GET = createLatestUploadHandler(prismaUploadStatusDependencies);
export const POST = createUploadHandler(prismaUploadDependencies);
```

- [ ] **Step 5: Run focused and Web API regression tests**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/web/tests/upload-api.integration.test.ts' 'apps/web/tests/auth-scope.test.ts'
```

Expected: all tests PASS.

- [ ] **Step 6: Create the Task 5 GitHub commit**

Commit the four Task 5 files as `feat: expose latest upload status` and fast-forward `main`.

---

### Task 6: Restore Upload State After Refresh

**Files:**
- Modify: `apps/web/components/admin/upload-client.tsx`
- Modify: `apps/web/components/admin/upload-result.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/tests/upload-client.test.ts`
- Modify: `apps/web/tests/merchant-project-admin.ui.test.tsx`

**Interfaces:**
- Produces: `loadLatestUpload(request?: LatestUploadRequest): Promise<UploadResultData | null>`.
- Consumes: `GET /api/admin/uploads` from Task 5.
- Extends `UploadResultData` with `id?: string` plus safe `failureStage` and `failureMessage` fields.

- [ ] **Step 1: Write failing refresh and failure-message tests**

Add pure loader tests:

```ts
expect(await loadLatestUpload(async () => Response.json({ id: 'batch-1', status: 'PROCESSING' })))
  .toMatchObject({ id: 'batch-1', status: 'PROCESSING' });
expect(await loadLatestUpload(async () => new Response(null, { status: 204 }))).toBeNull();
```

Add a static rendering test:

```ts
const html = renderToStaticMarkup(createElement(UploadResult, {
  result: { status: 'FAILED', failureStage: 'WORKER', failureMessage: '数据库写入超时，请重新上传。' },
}));
expect(html).toContain('数据库写入超时，请重新上传。');
expect(html).toContain('导入未通过');
```

- [ ] **Step 2: Run UI tests and verify RED**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/web/tests/upload-client.test.ts' 'apps/web/tests/merchant-project-admin.ui.test.tsx'
```

Expected: FAIL because the loader and failure rendering do not exist.

- [ ] **Step 3: Implement the latest-upload loader**

```ts
export async function loadLatestUpload(request: LatestUploadRequest = fetch): Promise<UploadResultData | null> {
  const response = await request('/api/admin/uploads');
  if (response.status === 204) return null;
  if (!response.ok) throw new Error('LATEST_UPLOAD_UNAVAILABLE');
  return response.json() as Promise<UploadResultData>;
}
```

- [ ] **Step 4: Restore and poll on component mount**

Use `useEffect` to call `loadLatestUpload` once. Set the returned result immediately; if it is `QUEUED` or `PROCESSING`, call the existing batch tracker with its `id`. Return a cleanup function that clears `timer.current`. Do not re-upload the file and do not create a new batch during restoration.

- [ ] **Step 5: Render the safe failure message**

When `result.status === 'FAILED'` and `failureMessage` exists, render:

```tsx
<div className="upload-failure" role="alert">
  <strong>失败原因</strong>
  <span>{result.failureMessage}</span>
</div>
```

Keep the existing counts and skipped-row issue list unchanged.

Add `.upload-failure` styles with the existing error palette, a readable line height, and wrapping for long messages. Do not add a new color system or animation.

- [ ] **Step 6: Run focused and complete Web tests**

Run Step 2, then:

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'apps/web/tests'
```

Expected: all tests PASS.

- [ ] **Step 7: Create the Task 6 GitHub commit**

Commit the five Task 6 files as `feat: restore latest upload after refresh` and fast-forward `main`.

---

### Task 7: Full Verification, Deployment, and Production Acceptance

**Files:**
- Verify all files changed in Tasks 1–6.
- Update: `docs/superpowers/plans/2026-08-23-bulk-import-reliability.md` checkboxes only after each command succeeds.

**Interfaces:**
- Consumes the complete implementation from Tasks 1–6.
- Produces a verified GitHub `main` commit and successful Railway Web/Worker deployments.

- [ ] **Step 1: Run the supplied workbook acceptance test**

```powershell
$env:DESIGNBAO_SOURCE_XLSX='C:\Users\Administrator\Desktop\非深圳【设计宝、小红书】.xlsx'
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run 'packages/importer/tests/real-workbook.acceptance.test.ts'
Remove-Item Env:DESIGNBAO_SOURCE_XLSX
```

Expected: PASS with 2,026 accepted and 89 skipped.

- [ ] **Step 2: Run the complete Vitest suite**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'node_modules\vitest\vitest.mjs' run apps/web/tests apps/worker/tests packages/domain/tests packages/db/tests packages/importer/tests packages/metrics/tests packages/rules/tests packages/storage/tests infra/backup/*.test.ts
```

Expected: zero failed tests.

- [ ] **Step 3: Run all eight TypeScript project checks**

Run `node_modules/typescript/bin/tsc --noEmit -p` with the bundled Node executable for:

```text
apps/web/tsconfig.json
apps/worker/tsconfig.json
packages/domain/tsconfig.json
packages/db/tsconfig.json
packages/importer/tsconfig.json
packages/metrics/tsconfig.json
packages/rules/tsconfig.json
packages/storage/tsconfig.json
```

Expected: every process exits 0 with no diagnostics.

- [ ] **Step 4: Run ESLint on every modified TypeScript/TSX file**

Use `node_modules/eslint/bin/eslint.js` with `--max-warnings=0` and the exact changed-file list from GitHub compare.

Expected: exit 0 with no warnings.

- [ ] **Step 5: Run the Next.js production build**

```powershell
& 'C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' 'apps/web/node_modules/next/dist/bin/next' build apps/web
```

Expected: compiled successfully and 18 routes generated.

- [ ] **Step 6: Verify GitHub history and Railway deployment**

Compare the pre-plan base with the final commit and confirm only planned files changed. Poll the combined status for the final commit until both contexts are `success`:

```text
striking-youthfulness - web
striking-youthfulness - worker
```

Stop and inspect Railway logs if either context reports failure.

- [ ] **Step 7: Re-submit the original production workbook once**

After both deployments succeed, open `https://web-production-445d5c.up.railway.app/admin/uploads`, select data date `2026/08/23`, select the original workbook, and click upload once. Do not submit it repeatedly.

- [ ] **Step 8: Verify production behavior**

Within five minutes verify:

```text
Upload result: SUCCEEDED or an explicit FAILED with a safe reason
Accepted: 2026 when SUCCEEDED
Skipped: 89 when SUCCEEDED
Refresh: latest result remains visible
Worker logs: batchId and lifecycle events are present
Homepage: imported merchant/project counts are no longer all zero after success
```

- [ ] **Step 9: Record final evidence**

Report the final commit URL, complete test counts, typecheck/lint/build exit status, Railway Web/Worker states, production batch status, accepted/skipped counts, and any remaining operational limitation. Do not claim success without the production batch result.
