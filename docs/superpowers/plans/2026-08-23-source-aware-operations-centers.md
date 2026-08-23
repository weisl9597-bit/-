# Source-Aware Operations Centers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home, Metrics, Merchant, and Project Centers share source/region/city/merchant filters and persist distinct Designbao, Xiaohongshu, and combined merchant classifications.

**Architecture:** Add an explicit business-source field to imported facts, metrics, classifications, rule hits, and source-scoped overrides. Recalculate source-specific and combined classifications in the Worker, backfill historical successful batches, then make every operational query consume the latest successful batch through one validated URL filter model and one reusable filter component.

**Tech Stack:** TypeScript 5.9, Node.js 22, Next.js 15 App Router, React 19, Prisma 6/PostgreSQL, Vitest 3, Playwright 1.55, pnpm 10, Railway.

**Spec:** `docs/superpowers/specs/2026-08-23-source-aware-operations-centers-design.md`

## Global Constraints

- UI sources are exactly `DESIGNBAO`, `XIAOHONGSHU`, and `ALL`; default is `DESIGNBAO`.
- `ALL` means Designbao plus Xiaohongshu only; `OTHER` is diagnostic data and is excluded from combined results.
- Combined rates use summed numerators divided by summed denominators; never average displayed percentages.
- `ProjectSnapshot` and `MetricSnapshot` may contain only actual sources: `DESIGNBAO`, `XIAOHONGSHU`, or `OTHER`.
- Each active merchant/date has three classification rows: `DESIGNBAO`, `XIAOHONGSHU`, and `ALL`; unavailable sources use `dataAvailable = false` with null classifications.
- `CONFIRM_C`, `TEMP_EXEMPT`, and `MANUAL_CLASSIFICATION` are source-scoped; `PERMANENT_EXCLUDE` is global.
- Canonical URL parameters are `source`, `regionId`, `cityId`, and `merchantId`; all drilldowns preserve them.
- The shared empty-state copy is `当前筛选范围暂无数据，请调整业务来源或组织范围。`
- Project Center labels the merchant column `装企`, shows merchant name as primary text, and merchant ID below in smaller secondary text.
- Designbao dispatch project count for 2026-08-01 through 2026-08-23 must remain exactly `561`.
- Historical rebuilds must be idempotent, preserve audit records, and retain the last successful visible result on failure.
- `SOURCE_AWARE_OPERATIONS_ENABLED` stays `false` through migration and rebuild, and changes to `true` only after rebuild acceptance passes.
- Do not edit any file under `sources/`.

---

### Task 1: Canonical Business Source in Domain and Importer

**Files:**
- Create: `packages/domain/src/business-source.ts`
- Create: `packages/domain/tests/business-source.test.ts`
- Modify: `packages/importer/src/mappings.ts`
- Modify: `packages/importer/src/parse-workbook.ts`
- Modify: `packages/importer/src/validate-batch.ts`
- Modify: `packages/importer/tests/parse-workbook.test.ts`
- Modify: `packages/importer/tests/validate-batch.test.ts`

**Interfaces:**
- Produces: `ActualBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'OTHER'`.
- Produces: `SelectableBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL'`.
- Produces: `normalizeBusinessSource(value: unknown): ActualBusinessSource`.
- Produces: `CanonicalProjectRow.businessSource: ActualBusinessSource` for import and Worker tasks.

- [ ] **Step 1: Write failing normalization tests**

```ts
import { describe, expect, it } from 'vitest';
import { normalizeBusinessSource } from '../src/business-source';

describe('normalizeBusinessSource', () => {
  it.each([
    ['设计宝', 'DESIGNBAO'],
    [' 设计宝 ', 'DESIGNBAO'],
    ['小红书', 'XIAOHONGSHU'],
    ['未知渠道', 'OTHER'],
    [null, 'OTHER'],
  ] as const)('maps %j to %s', (input, expected) => {
    expect(normalizeBusinessSource(input)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the domain test and verify failure**

Run: `pnpm exec vitest run packages/domain/tests/business-source.test.ts`

Expected: FAIL because `../src/business-source` does not exist.

- [ ] **Step 3: Add the source types and normalizer**

```ts
export type ActualBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'OTHER';
export type SelectableBusinessSource = 'DESIGNBAO' | 'XIAOHONGSHU' | 'ALL';

export function normalizeBusinessSource(value: unknown): ActualBusinessSource {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === '设计宝') return 'DESIGNBAO';
  if (normalized === '小红书') return 'XIAOHONGSHU';
  return 'OTHER';
}
```

- [ ] **Step 4: Add the business-source column to parsing and canonical validation**

Add `businessSource: ['类别']` to `projectColumns`, rename the current ambiguous canonical `category` use to `businessSourceRaw`, and return the normalized value from validation:

```ts
import { normalizeBusinessSource, type ActualBusinessSource } from '@designbao/domain/business-source';

export type CanonicalProjectRow = {
  // existing fields
  businessSource: ActualBusinessSource;
};

records.push({
  // existing fields
  businessSource: normalizeBusinessSource(row.category || row.raw.F),
  raw: row.raw,
});
```

Keep the raw `category` property during this task only where current callers still require it; remove it after all compile errors have been migrated to `businessSource`.

- [ ] **Step 5: Add importer assertions**

```ts
expect(result.records.find((row) => row.projectId === 'P-DESIGN')?.businessSource)
  .toBe('DESIGNBAO');
expect(result.records.find((row) => row.projectId === 'P-RED')?.businessSource)
  .toBe('XIAOHONGSHU');
expect(result.records.find((row) => row.projectId === 'P-UNKNOWN')?.businessSource)
  .toBe('OTHER');
```

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm exec vitest run packages/domain/tests/business-source.test.ts packages/importer/tests/parse-workbook.test.ts packages/importer/tests/validate-batch.test.ts`

Expected: all tests PASS.

Run: `pnpm exec tsc --noEmit -p packages/domain/tsconfig.json && pnpm exec tsc --noEmit -p packages/importer/tsconfig.json`

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/business-source.ts packages/domain/tests/business-source.test.ts packages/importer/src packages/importer/tests
git commit -m "feat: normalize imported business sources"
```

### Task 2: Business-Source Database Schema and Backfill Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260823_business_source_operations/migration.sql`
- Modify: `packages/db/tests/schema.integration.test.ts`

**Interfaces:**
- Consumes: `ActualBusinessSource` semantics from Task 1.
- Produces: Prisma `BusinessSource` enum and generated fields used by every later repository.
- Produces: unique classification key `merchantId_dataDate_businessSource`.
- Produces: explicit `ProjectSnapshot.assignedAt` for latest-batch Project Center queries.

- [ ] **Step 1: Add failing schema contract assertions**

```ts
const schema = await readFile('packages/db/prisma/schema.prisma', 'utf8');
expect(schema).toContain('enum BusinessSource');
expect(schema).toContain('businessSource BusinessSource');
expect(schema).toContain('dataAvailable Boolean');
expect(schema).toContain('@@unique([merchantId, dataDate, businessSource])');
expect(schema).toContain('assignedAt       DateTime');
```

- [ ] **Step 2: Run the schema test and verify failure**

Run: `pnpm exec vitest run packages/db/tests/schema.integration.test.ts`

Expected: FAIL on the missing enum or fields.

- [ ] **Step 3: Update the Prisma schema**

Use these field contracts:

```prisma
enum BusinessSource {
  DESIGNBAO
  XIAOHONGSHU
  OTHER
  ALL
}

model ProjectSnapshot {
  // existing fields
  businessSource BusinessSource
  assignedAt     DateTime
  @@index([businessSource, organizationId, dataDate])
}

model MetricSnapshot {
  // existing fields
  businessSource BusinessSource
  @@unique([metricId, grain, periodStart, organizationId, dimensionKey, businessSource, sourceBatchId], name: "metric_snapshot_grain")
  @@index([businessSource, organizationId, periodStart])
}

model MerchantClassificationSnapshot {
  // existing fields
  businessSource BusinessSource
  dataAvailable  Boolean @default(true)
  classification MerchantClassification?
  suggested      MerchantClassification?
  @@unique([merchantId, dataDate, businessSource])
  @@index([businessSource, classification, dataDate])
}

model RuleHit {
  // existing fields
  businessSource BusinessSource
  @@unique([code, entityType, entityId, dataDate, version, businessSource])
}

model MerchantOverride {
  // existing fields
  businessSource BusinessSource?
  @@index([merchantId, businessSource, startDate, endDate])
}
```

Application validation will reject `ALL` on project, metric, and project rule-hit writes even though the shared database enum contains it.

- [ ] **Step 4: Write the additive and backfill SQL migration**

The migration must execute in this order:

```sql
CREATE TYPE "BusinessSource" AS ENUM ('DESIGNBAO', 'XIAOHONGSHU', 'OTHER', 'ALL');

ALTER TABLE "ProjectSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "ProjectSnapshot" ADD COLUMN "assignedAt" TIMESTAMP(3);
ALTER TABLE "MetricSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantClassificationSnapshot" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantClassificationSnapshot" ADD COLUMN "dataAvailable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "classification" DROP NOT NULL;
ALTER TABLE "MerchantClassificationSnapshot" ALTER COLUMN "suggested" DROP NOT NULL;
ALTER TABLE "RuleHit" ADD COLUMN "businessSource" "BusinessSource";
ALTER TABLE "MerchantOverride" ADD COLUMN "businessSource" "BusinessSource";

UPDATE "ProjectSnapshot" snapshot
SET "businessSource" = CASE trim(COALESCE(snapshot."raw"->>'F', ''))
  WHEN '设计宝' THEN 'DESIGNBAO'::"BusinessSource"
  WHEN '小红书' THEN 'XIAOHONGSHU'::"BusinessSource"
  ELSE 'OTHER'::"BusinessSource"
END,
"assignedAt" = project."assignedAt"
FROM "Project" project
WHERE project."id" = snapshot."projectId";

UPDATE "MetricSnapshot"
SET "businessSource" = CASE
  WHEN "dimensionKey" LIKE 'source:DESIGNBAO|%' THEN 'DESIGNBAO'::"BusinessSource"
  WHEN "dimensionKey" LIKE 'source:XIAOHONGSHU|%' THEN 'XIAOHONGSHU'::"BusinessSource"
  ELSE 'OTHER'::"BusinessSource"
END;

UPDATE "MerchantClassificationSnapshot" SET "businessSource" = 'ALL';
UPDATE "MerchantOverride"
SET "businessSource" = CASE WHEN "type" = 'PERMANENT_EXCLUDE' THEN NULL ELSE 'ALL'::"BusinessSource" END;

UPDATE "RuleHit" hit
SET "businessSource" = COALESCE(
  (SELECT snapshot."businessSource" FROM "ProjectSnapshot" snapshot
   WHERE snapshot."projectId" = hit."projectId" AND snapshot."dataDate" = hit."dataDate"
   ORDER BY snapshot."createdAt" DESC LIMIT 1),
  'OTHER'::"BusinessSource"
);
```

Then drop old unique constraints, create the new constraints/indexes from the schema, mark project/metric/classification/rule-hit source fields and project `assignedAt` non-null, and remove the temporary defaults. The migration must abort if any required backfill remains null.

- [ ] **Step 5: Generate Prisma Client and run schema tests**

Run: `pnpm --filter @designbao/db exec prisma generate`

Expected: Prisma Client generates successfully.

Run: `pnpm exec vitest run packages/db/tests/schema.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Validate the migration against a disposable PostgreSQL database**

Run: `pnpm --filter @designbao/db exec prisma migrate deploy`

Expected: migration applies successfully; the post-migration null checks pass and Prisma reports no pending migration. Use only the disposable integration-test database at this step, never the Railway production database.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma packages/db/tests/schema.integration.test.ts
git commit -m "feat: add business source persistence"
```

### Task 3: Persist Source and Assignment Facts During Import

**Files:**
- Modify: `apps/worker/src/jobs/bulk-import-plan.ts`
- Modify: `apps/worker/src/jobs/prisma-import-repository.ts`
- Modify: `apps/worker/tests/bulk-import-plan.test.ts`
- Modify: `apps/worker/tests/prisma-import-repository.test.ts`
- Modify: `apps/worker/tests/import-batch.integration.test.ts`

**Interfaces:**
- Consumes: `CanonicalProjectRow.businessSource` from Task 1.
- Consumes: required Prisma fields from Task 2.
- Produces: every new `ProjectSnapshot` with actual `businessSource` and immutable `assignedAt`.

- [ ] **Step 1: Add failing import-plan assertions**

```ts
expect(plan.projectSnapshots[0]).toMatchObject({
  projectId: 'P1::M1',
  merchantId: 'M1',
  businessSource: 'DESIGNBAO',
  assignedAt: '2026-08-03T10:15:00.000Z',
});
```

Also add a Xiaohongshu record and assert its snapshot is `XIAOHONGSHU`.

- [ ] **Step 2: Run Worker import tests and verify failure**

Run: `pnpm exec vitest run apps/worker/tests/bulk-import-plan.test.ts apps/worker/tests/prisma-import-repository.test.ts`

Expected: FAIL because snapshot inputs omit `businessSource` and `assignedAt`.

- [ ] **Step 3: Extend the import-plan snapshot type and mapping**

```ts
type ProjectSnapshotPlan = {
  // existing fields
  businessSource: CanonicalProjectRow['businessSource'];
  assignedAt: string;
};

const snapshot = {
  // existing fields
  businessSource: record.businessSource,
  assignedAt: record.assignedAt,
};
```

- [ ] **Step 4: Bind the new fields in bulk upsert/create operations**

The snapshot create/upsert data must include:

```ts
businessSource: snapshot.businessSource,
assignedAt: new Date(snapshot.assignedAt),
```

Do not derive source again from JSON in the repository.

- [ ] **Step 5: Add idempotency coverage**

Run the same successful import twice and assert one snapshot per `(dataDate, projectId)`, with the second import updating its `uploadBatchId`, `businessSource`, and `assignedAt` to the newest accepted batch values.

```ts
expect(await countProjectSnapshots('P1::M1', '2026-08-23')).toBe(1);
```

- [ ] **Step 6: Run focused and integration tests**

Run: `pnpm exec vitest run apps/worker/tests/bulk-import-plan.test.ts apps/worker/tests/prisma-import-repository.test.ts apps/worker/tests/import-batch.integration.test.ts`

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/jobs/bulk-import-plan.ts apps/worker/src/jobs/prisma-import-repository.ts apps/worker/tests
git commit -m "feat: persist project business sources"
```

### Task 4: Explicit Source Metric Snapshots and Combined Aggregation

**Files:**
- Modify: `packages/metrics/src/calculate.ts`
- Modify: `packages/metrics/src/snapshots.ts`
- Modify: `packages/metrics/src/query.ts`
- Modify: `packages/metrics/tests/calculate.test.ts`
- Modify: `packages/metrics/tests/snapshots.integration.test.ts`
- Modify: `apps/worker/src/jobs/calculate-metrics.ts`
- Modify: `apps/worker/tests/calculate-metrics.test.ts`
- Modify: `apps/web/lib/queries/metrics.ts`
- Modify: `apps/web/tests/query-api.integration.test.ts`

**Interfaces:**
- Consumes: explicit `BusinessSource` database field.
- Produces: `MetricSnapshotInput.businessSource: ActualBusinessSource`.
- Produces: `StoredDailyMetric.businessSource: ActualBusinessSource`.
- Preserves: `MetricQuery.source: SelectableBusinessSource` and combined numerator/denominator aggregation.

- [ ] **Step 1: Add failing snapshot tests for explicit source**

```ts
expect(inserted).toEqual(expect.arrayContaining([
  expect.objectContaining({
    metricId: 'dispatch_project_count',
    businessSource: 'DESIGNBAO',
    dimensionKey: 'organization',
  }),
  expect.objectContaining({
    metricId: 'dispatch_project_count',
    businessSource: 'XIAOHONGSHU',
    dimensionKey: 'organization',
  }),
]));
```

- [ ] **Step 2: Add a failing combined-rate query test**

```ts
const rows = [
  { businessSource: 'DESIGNBAO', numerator: 1, denominator: 2 },
  { businessSource: 'XIAOHONGSHU', numerator: 8, denominator: 8 },
];
// ALL = 9 / 10 = 90%, not (50% + 100%) / 2 = 75%.
expect(allSeries.points[0]).toMatchObject({ value: 90, numerator: 9, denominator: 10 });
```

- [ ] **Step 3: Run focused metric tests and verify failure**

Run: `pnpm exec vitest run packages/metrics/tests/snapshots.integration.test.ts apps/worker/tests/calculate-metrics.test.ts apps/web/tests/query-api.integration.test.ts`

Expected: FAIL because source still lives inside `dimensionKey`.

- [ ] **Step 4: Write explicit-source snapshots**

Update the contract and key construction:

```ts
export type MetricSnapshotInput = {
  // existing fields
  businessSource: ActualBusinessSource;
};

dimensionKey: scope === 'merchant' ? `merchant:${merchantId}` : 'organization',
businessSource,
```

In `calculate-metrics.ts`, import and reuse `normalizeBusinessSource`; delete the local duplicate normalizer.

- [ ] **Step 5: Query by the source column and deduplicate latest batches correctly**

```ts
businessSource: query.source === 'ALL'
  ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] }
  : query.source,
```

Use the latest successful snapshot for each `(metricId, periodStart, organizationId, merchantId, businessSource, dimensionKey)` before the series layer combines values. Include `businessSource` in the deduplication key and returned `StoredDailyMetric`.

- [ ] **Step 6: Run metric, Worker, and API tests**

Run: `pnpm exec vitest run packages/metrics/tests apps/worker/tests/calculate-metrics.test.ts apps/web/tests/query-api.integration.test.ts`

Expected: all tests PASS, including the 90% combined-rate example.

- [ ] **Step 7: Commit**

```bash
git add packages/metrics apps/worker/src/jobs/calculate-metrics.ts apps/worker/tests/calculate-metrics.test.ts apps/web/lib/queries/metrics.ts apps/web/tests/query-api.integration.test.ts
git commit -m "feat: query metrics by explicit business source"
```

### Task 5: Three Source-Aware Merchant Classifications and Scoped Overrides

**Files:**
- Modify: `packages/rules/src/evaluate.ts`
- Modify: `packages/rules/src/merchant-classification.ts`
- Modify: `packages/rules/src/project-alerts.ts`
- Modify: `packages/rules/tests/evaluate.test.ts`
- Modify: `packages/rules/tests/merchant-classification.test.ts`
- Modify: `packages/rules/tests/project-alerts.test.ts`
- Modify: `apps/worker/src/jobs/evaluate-rules.ts`
- Modify: `apps/worker/tests/evaluate-rules.test.ts`
- Modify: `apps/web/lib/admin/merchant-decision-handler.ts`
- Modify: `apps/web/lib/admin/prisma-merchant-decisions.ts`
- Modify: `apps/web/components/admin/merchant-decision-panel.tsx`
- Modify: `apps/web/components/admin/merchant-decisions-client.tsx`
- Modify: `apps/web/tests/merchant-decision.test.ts`

**Interfaces:**
- Produces: `MerchantClassificationInput.businessSource: SelectableBusinessSource` and `dataAvailable: boolean`.
- Produces: `ClassificationDecision.businessSource`, nullable `suggested`, and rule version `v2`.
- Produces: `ProjectAlert.businessSource: ActualBusinessSource`.
- Consumes: source-scoped override semantics from the spec.

- [ ] **Step 1: Add failing rule tests for three rows**

```ts
expect(decisions).toEqual(expect.arrayContaining([
  expect.objectContaining({ merchantId: 'M1', businessSource: 'DESIGNBAO', suggested: 'A' }),
  expect.objectContaining({ merchantId: 'M1', businessSource: 'XIAOHONGSHU', suggested: 'B' }),
  expect.objectContaining({ merchantId: 'M1', businessSource: 'ALL', suggested: 'A_RISK' }),
]));
```

Add a merchant with no Xiaohongshu project and assert:

```ts
expect(decisions).toContainEqual(expect.objectContaining({
  merchantId: 'M2', businessSource: 'XIAOHONGSHU', dataAvailable: false, suggested: null,
}));
```

- [ ] **Step 2: Add failing override and alert tests**

```ts
expect(designbaoInput.cConfirmed).toBe(true);
expect(xiaohongshuInput.cConfirmed).toBe(false);
expect(allInput.permanentlyExcluded).toBe(true);
expect(projectAlert).toMatchObject({ businessSource: 'DESIGNBAO' });
```

- [ ] **Step 3: Run rule tests and verify failure**

Run: `pnpm exec vitest run packages/rules/tests apps/worker/tests/evaluate-rules.test.ts apps/web/tests/merchant-decision.test.ts`

Expected: FAIL because inputs and persisted decisions are source-agnostic.

- [ ] **Step 4: Extend rule contracts and preserve no-data classifications**

```ts
export type ClassificationDecision = {
  merchantId: string;
  businessSource: SelectableBusinessSource;
  dataAvailable: boolean;
  suggested: MerchantClassification | null;
  requiresConfirmation: boolean;
  ruleVersion: 'v2';
  evidence: Array<{ metricId: string; value: number | boolean | null; comparison?: number }>;
  reason: string;
};

if (!input.dataAvailable) {
  return {
    merchantId: input.merchantId,
    businessSource: input.businessSource,
    dataAvailable: false,
    suggested: null,
    requiresConfirmation: false,
    ruleVersion: 'v2',
    evidence: [],
    reason: '该来源暂无数据',
  };
}
```

- [ ] **Step 5: Build source-specific and combined inputs in the Worker**

For every merchant in the batch, create inputs in this fixed order:

```ts
const sources = ['DESIGNBAO', 'XIAOHONGSHU', 'ALL'] as const;
return merchants.flatMap((merchantId) =>
  sources.map((businessSource) => buildMerchantInput(merchantId, businessSource)),
);
```

`ALL` metric rows include only `DESIGNBAO` and `XIAOHONGSHU`. Compute rates with `aggregateRate` over both sources' numerator/denominator rows. Read previous classification and non-global overrides by the same `businessSource`; apply `PERMANENT_EXCLUDE` rows where `businessSource` is null to all three inputs. Derive `lastAssignedAt` from filtered project snapshots, not the mixed `Project` table.

- [ ] **Step 6: Replace generated results transactionally**

Within one transaction for a batch/date, replace generated v2 rule hits and upsert each classification by `(merchantId, dataDate, businessSource)`:

```ts
await transaction.ruleHit.deleteMany({ where: { sourceBatchId: batchId, version: 'v2' } });
for (const row of classificationRows) {
  const existing = await transaction.merchantClassificationSnapshot.findUnique({
    where: {
      merchantId_dataDate_businessSource: {
        merchantId: row.merchantId,
        dataDate: dateOnly(dataDate),
        businessSource: row.businessSource,
      },
    },
  });
  await transaction.merchantClassificationSnapshot.upsert({
    where: {
      merchantId_dataDate_businessSource: {
        merchantId: row.merchantId,
        dataDate: dateOnly(dataDate),
        businessSource: row.businessSource,
      },
    },
    create: row,
    update: existing?.confirmedById
      ? {
          suggested: row.suggested,
          reason: row.reason,
          evidence: row.evidence,
          ruleVersion: row.ruleVersion,
          dataAvailable: row.dataAvailable,
        }
      : row,
  });
}
```

Write `classification = suggested` only when `dataAvailable`; otherwise both are null. For a confirmed row, update only the system suggestion/evidence fields shown above and retain `classification`, `requiresConfirmation`, `confirmedById`, and `effectiveAt`. Current project-alert queries use v2 hits after rebuild, while v1 rows remain historical audit data.

- [ ] **Step 7: Require a source for non-global decisions**

Extend `MerchantDecisionInput` with `businessSource`. Validate request bodies as follows:

```ts
if (type === 'PERMANENT_EXCLUDE') businessSource = null;
else if (!['DESIGNBAO', 'XIAOHONGSHU', 'ALL'].includes(String(body.businessSource))) {
  return jsonError('BUSINESS_SOURCE_REQUIRED', 400);
}
```

The admin candidate API and `merchant-decisions-client.tsx` list candidates by selected source. The panel submits a hidden or selected `businessSource`, displays `当前作用范围：设计宝/小红书/全部业务`, and shows a confirmation warning for global permanent exclusion.

- [ ] **Step 8: Run rule, decision, and Worker tests**

Run: `pnpm exec vitest run packages/rules/tests apps/worker/tests/evaluate-rules.test.ts apps/web/tests/merchant-decision.test.ts`

Expected: all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/rules apps/worker/src/jobs/evaluate-rules.ts apps/worker/tests/evaluate-rules.test.ts apps/web/lib/admin apps/web/components/admin/merchant-decision-panel.tsx apps/web/tests/merchant-decision.test.ts
git commit -m "feat: classify merchants per business source"
```

### Task 6: Historical Rebuild Queue and Visible Rebuild Status

**Files:**
- Create: `scripts/requeue-business-source-rebuild.ts`
- Create: `apps/web/lib/queries/rebuild-status.ts`
- Create: `apps/web/tests/rebuild-status.test.ts`
- Modify: `packages/db/src/jobs.ts`
- Modify: `packages/db/tests/jobs.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: command `pnpm rebuild:business-source`.
- Produces: job payload marker `rebuildVersion: 'business-source-v2'`.
- Produces: `getBusinessSourceRebuildStatus(): { state; total; completed; failed; lastSuccessfulDate }`.

- [ ] **Step 1: Write failing job-order and status tests**

```ts
expect(requeued.map((row) => row.dataDate)).toEqual([
  '2026-08-01', '2026-08-02', '2026-08-03',
]);
expect(status).toEqual({
  state: 'RUNNING', total: 3, completed: 1, failed: 0, lastSuccessfulDate: '2026-08-01',
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm exec vitest run packages/db/tests/jobs.integration.test.ts apps/web/tests/rebuild-status.test.ts`

Expected: FAIL because the rebuild function and status query do not exist.

- [ ] **Step 3: Add the chronological requeue operation**

Expose a database function that selects successful batches ordered by `dataDate ASC, createdAt ASC`, then resets their METRICS jobs with staggered `availableAt` and tagged payloads:

```ts
payload: {
  ...existingPayload,
  dataDate,
  rebuildVersion: 'business-source-v2',
},
status: 'QUEUED',
attempts: 0,
availableAt: new Date(now.getTime() + index * 1_000),
lastError: null,
```

Tag the corresponding RULES payload with the same rebuild version without prematurely marking it complete. Existing METRICS completion will requeue the RULES job.

- [ ] **Step 4: Implement the one-shot script**

```ts
import { requeueBusinessSourceRebuild } from '@designbao/db/jobs';

const result = await requeueBusinessSourceRebuild('business-source-v2');
console.log(JSON.stringify({ event: 'business_source_rebuild_queued', ...result }));
```

Add the root script:

```json
"rebuild:business-source": "tsx scripts/requeue-business-source-rebuild.ts"
```

- [ ] **Step 5: Implement rebuild status from tagged jobs**

A batch is complete only when both tagged METRICS and RULES jobs succeeded and the RULES `updatedAt` is not older than METRICS `updatedAt`. It is failed when either tagged job has exhausted retries and is `FAILED`. Otherwise it is pending/running.

```ts
export type BusinessSourceRebuildStatus = {
  state: 'IDLE' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  total: number;
  completed: number;
  failed: number;
  lastSuccessfulDate: string | null;
};
```

- [ ] **Step 6: Run focused tests and dry-run typecheck**

Run: `pnpm exec vitest run packages/db/tests/jobs.integration.test.ts apps/web/tests/rebuild-status.test.ts`

Expected: PASS.

Run: `pnpm exec tsc --noEmit -p packages/db/tsconfig.json && pnpm exec tsc --noEmit -p apps/web/tsconfig.json`

Expected: exit code 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/requeue-business-source-rebuild.ts apps/web/lib/queries/rebuild-status.ts apps/web/tests/rebuild-status.test.ts packages/db/src/jobs.ts packages/db/tests/jobs.integration.test.ts package.json
git commit -m "feat: queue source-aware historical rebuilds"
```

### Task 7: Shared Operations Filter API, URL State, and Component

**Files:**
- Create: `apps/web/lib/queries/operations-filters.ts`
- Create: `apps/web/lib/queries/operations-scope.ts`
- Create: `apps/web/app/api/filters/operations/route.ts`
- Create: `apps/web/components/filters/use-operations-filters.ts`
- Create: `apps/web/components/filters/operations-filter-bar.tsx`
- Create: `apps/web/components/filters/rebuild-banner.tsx`
- Create: `apps/web/lib/operations-rollout.ts`
- Modify: `.env.example`
- Create: `apps/web/tests/operations-filters.test.ts`
- Create: `apps/web/tests/operations-filter-bar.ui.test.tsx`
- Modify: `apps/web/lib/queries/request.ts`
- Modify: `apps/web/app/api/metrics/filters/route.ts`
- Modify: `apps/web/lib/queries/metric-filters.ts`

**Interfaces:**
- Produces: `OperationsFilter = { source; regionId?; cityId?; merchantId? }`.
- Produces: `parseOperationsFilter(url: URL): OperationsFilter`.
- Produces: `resolveOperationsSelection(filter, scope): Promise<OperationsSelection>`.
- Produces: `useOperationsFilters()` and `<OperationsFilterBar />` for all four pages.
- Produces: `sourceAwareOperationsEnabled(): boolean` and `<RebuildBanner />` for the guarded rollout.

- [ ] **Step 1: Write failing parser and authorization tests**

```ts
expect(parseOperationsFilter(new URL('https://test/?source=ALL&regionId=r1&cityId=c1&merchantId=m1')))
  .toEqual({ source: 'ALL', regionId: 'r1', cityId: 'c1', merchantId: 'm1' });
expect(parseOperationsFilter(new URL('https://test/'))).toEqual({ source: 'DESIGNBAO' });
await expect(resolveOperationsSelection(
  { source: 'DESIGNBAO', cityId: 'city-outside' }, cityScope, repository,
)).rejects.toThrow('ORGANIZATION_OUT_OF_SCOPE');
```

- [ ] **Step 2: Write failing component behavior tests**

```tsx
fireEvent.change(screen.getByLabelText('大区'), { target: { value: 'region-2' } });
expect(screen.getByLabelText('城市')).toHaveValue('');
expect(screen.getByLabelText('商家')).toHaveValue('');
expect(window.location.search).toContain('source=DESIGNBAO');
```

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/operations-filters.test.ts apps/web/tests/operations-filter-bar.ui.test.tsx`

Expected: FAIL because the shared filter modules do not exist.

- [ ] **Step 4: Implement validated filter parsing and scope resolution**

```ts
export type OperationsFilter = {
  source: SelectableBusinessSource;
  regionId?: string;
  cityId?: string;
  merchantId?: string;
};

export function parseOperationsFilter(url: URL): OperationsFilter {
  return {
    source: z.enum(['DESIGNBAO', 'XIAOHONGSHU', 'ALL'])
      .parse(url.searchParams.get('source') ?? 'DESIGNBAO'),
    regionId: url.searchParams.get('regionId') || undefined,
    cityId: url.searchParams.get('cityId') || undefined,
    merchantId: url.searchParams.get('merchantId') || undefined,
  };
}
```

Resolution verifies region/city ancestry, user organization scope, and merchant membership. Return `ORGANIZATION_OUT_OF_SCOPE` or `MERCHANT_OUT_OF_SCOPE` instead of widening the query.

Implement the rollout switch with an exact true value:

```ts
export function sourceAwareOperationsEnabled(): boolean {
  return process.env.SOURCE_AWARE_OPERATIONS_ENABLED === 'true';
}
```

Add `SOURCE_AWARE_OPERATIONS_ENABLED=false` to `.env.example`; production remains false until Task 12 acceptance succeeds.

When false, operational query entry points use their preserved legacy repository paths and the filter-options response returns `enabled: false`. When true, they use the new source-aware paths and return `enabled: true`. This switch guards reads only; importer, metrics, rules, and rebuild writes always use the new source model.

- [ ] **Step 5: Implement source-aware option loading**

`GET /api/filters/operations?source=DESIGNBAO` returns only regions, cities, and merchants present in the latest successful batch for the selected source. For `ALL`, include snapshots whose actual source is Designbao or Xiaohongshu. Retain `/api/metrics/filters` as a compatibility delegate to the same query during rollout. The response also includes rebuild status and the rollout `enabled` flag.

- [ ] **Step 6: Implement reusable URL state and the filter bar**

```ts
export type OperationsFilterController = {
  value: OperationsFilter;
  setSource(source: SelectableBusinessSource): void;
  setRegion(regionId: string): void;
  setCity(cityId: string): void;
  setMerchant(merchantId: string): void;
  toSearchParams(extra?: Record<string, string>): URLSearchParams;
};
```

The setters clear invalid downstream values and call `window.history.replaceState`. The component labels are exactly `业务来源`, `大区`, `城市`, `商家`.

- [ ] **Step 7: Run filter tests and Web typecheck**

Run: `pnpm exec vitest run apps/web/tests/operations-filters.test.ts apps/web/tests/operations-filter-bar.ui.test.tsx apps/web/tests/metric-filters.test.ts`

Expected: PASS.

Run: `pnpm exec tsc --noEmit -p apps/web/tsconfig.json`

Expected: exit code 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries apps/web/app/api/filters apps/web/app/api/metrics/filters/route.ts apps/web/components/filters apps/web/tests
git commit -m "feat: share operations filter state"
```

### Task 8: Source-Aware Home Dashboard

**Files:**
- Modify: `apps/web/lib/queries/dashboard.ts`
- Modify: `apps/web/app/api/dashboard/route.ts`
- Modify: `apps/web/app/page.tsx`
- Modify: `apps/web/components/dashboard/dashboard-view.tsx`
- Modify: `apps/web/tests/query-api.integration.test.ts`
- Modify: `apps/web/tests/dashboard.ui.test.tsx`

**Interfaces:**
- Consumes: `OperationsFilter`, `OperationsSelection`, and shared filter component from Task 7.
- Produces: filtered dashboard summary, source-specific classification structure, preserved drilldown URLs, and rebuild banner data.

- [ ] **Step 1: Add failing query assertions**

```ts
await getDashboard(
  { source: 'XIAOHONGSHU', cityId: 'city-1' },
  cityScope,
  repository,
);
expect(receivedSelection).toMatchObject({ source: 'XIAOHONGSHU', organizationIds: ['city-1'] });
expect(result.summary.merchantTotal).toBe(2);
```

Repository fixtures must include a Designbao-only merchant and assert it is excluded.

- [ ] **Step 2: Add failing UI link assertions**

```tsx
expect(screen.getByRole('link', { name: /待辅导项目/ }))
  .toHaveAttribute('href', expect.stringContaining('source=XIAOHONGSHU'));
expect(screen.getByText(/数据更新至 2026-08-23/)).toHaveTextContent('小红书');
```

- [ ] **Step 3: Run dashboard tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/dashboard.ui.test.tsx`

Expected: FAIL because Dashboard ignores request filters.

- [ ] **Step 4: Query the latest successful batch snapshot**

Change the repository contract to accept the resolved selection. Count distinct `merchantId` from filtered `ProjectSnapshot`, filter actual source with:

```ts
businessSource: source === 'ALL'
  ? { in: ['DESIGNBAO', 'XIAOHONGSHU'] }
  : source,
```

Read the latest classification at or before the batch date with `businessSource: source`; for `ALL`, use the persisted `ALL` classification row. Ignore rows with `dataAvailable = false` in structure counts.

- [ ] **Step 5: Parse filters in the route and load them on the page**

```ts
const filter = parseOperationsFilter(new URL(request.url));
return Response.json(await getDashboard(filter, authorization.scope));
```

The page uses `useOperationsFilters`, renders `OperationsFilterBar` only when the rollout response is enabled, and refetches `/api/dashboard` whenever source/region/city/merchant changes. Preserve the original dashboard repository code as `legacyDashboardRepository` and select it while the rollout flag is false; add direct tests for both flag states.

- [ ] **Step 6: Preserve filters in every dashboard drilldown**

Create links with the controller's `toSearchParams`:

```ts
href={`/projects?${filters.toSearchParams({ coached: 'blank' })}`}
href={`/merchants?${filters.toSearchParams({ classification })}`}
```

Render the shared empty state when the latest batch exists but the selected scope has zero projects. Render the rebuild banner when status is `RUNNING` or `FAILED`.

- [ ] **Step 7: Run dashboard tests**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/dashboard.ui.test.tsx apps/web/tests/root-page.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries/dashboard.ts apps/web/app/api/dashboard/route.ts apps/web/app/page.tsx apps/web/components/dashboard/dashboard-view.tsx apps/web/tests
git commit -m "feat: filter dashboard by business source"
```

### Task 9: Source-Aware Merchant Center and Details

**Files:**
- Modify: `apps/web/lib/queries/merchants.ts`
- Modify: `apps/web/lib/queries/request.ts`
- Modify: `apps/web/app/api/merchants/route.ts`
- Modify: `apps/web/app/api/merchants/[id]/route.ts`
- Modify: `apps/web/components/merchants/merchants-center-client.tsx`
- Modify: `apps/web/components/merchants/merchant-detail.tsx`
- Modify: `apps/web/tests/query-api.integration.test.ts`
- Modify: `apps/web/tests/merchant-project-admin.ui.test.tsx`

**Interfaces:**
- Consumes: shared Operations filters and source-scoped classifications.
- Produces: merchant list and detail values from the same latest batch and selected source.

- [ ] **Step 1: Add failing merchant repository tests**

```ts
expect(items[0]).toMatchObject({
  id: 'M1',
  classification: 'B',
  dataAvailable: true,
  projectCount: 3,
  sopRate: 55,
  lastAssignedAt: '2026-08-20T00:00:00.000Z',
});
expect(items.map((item) => item.id)).not.toContain('M-DESIGNBAO-ONLY');
```

- [ ] **Step 2: Add failing source-switch detail test**

```tsx
fireEvent.change(screen.getByLabelText('业务来源'), { target: { value: 'XIAOHONGSHU' } });
await waitFor(() => expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining('/api/merchants/M1?source=XIAOHONGSHU'),
));
```

- [ ] **Step 3: Run merchant tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/merchant-project-admin.ui.test.tsx`

Expected: FAIL because the list reads mixed `Merchant.projects`, latest mixed metrics, and one classification.

- [ ] **Step 4: Rebuild list queries from latest-batch snapshots**

Resolve the current batch once, then select merchants present in filtered project snapshots. Compute project count and latest assignment from those snapshots, SOP from explicit-source metric snapshots, and classification from the selected source row. Apply classification filtering after selecting the correct source/date.

For `ALL`, project counts union Designbao and Xiaohongshu snapshot projects and SOP uses summed metric numerator/denominator. Do not sum already displayed rates.

- [ ] **Step 5: Make detail data source-aware**

`GET /api/merchants/:id` accepts all four filter parameters, authorizes the merchant within the resolved organization selection, and returns:

```ts
type MerchantDetailData = {
  id: string;
  name: string;
  source: SelectableBusinessSource;
  classification: MerchantClassification | null;
  dataAvailable: boolean;
  reason: string;
  sopRate: number | null;
  projects: Array<{ id: string; sourceProjectId: string; businessSource: ActualBusinessSource }>;
};
```

- [ ] **Step 6: Add the shared filter UI and source-scoped decisions**

Render `OperationsFilterBar` above existing search/classification controls. Re-fetch list and open detail with the same URL state. Pass selected source to `MerchantDecisionPanel`; show `该来源暂无数据` for a null no-data classification rather than `未分类`.

Preserve the original mixed-current-table repository as `legacyMerchantListRepository` and original detail query as `getLegacyMerchantDetail`. Use them only while `SOURCE_AWARE_OPERATIONS_ENABLED` is false; tests must prove false uses legacy and true uses source-aware data.

- [ ] **Step 7: Run merchant tests**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/merchant-project-admin.ui.test.tsx apps/web/tests/merchant-decision.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries/merchants.ts apps/web/lib/queries/request.ts apps/web/app/api/merchants apps/web/components/merchants apps/web/tests
git commit -m "feat: filter merchant center by source"
```

### Task 10: Source-Aware Project Center with Merchant Name Display

**Files:**
- Modify: `apps/web/lib/queries/projects.ts`
- Modify: `apps/web/lib/queries/request.ts`
- Modify: `apps/web/app/api/projects/route.ts`
- Modify: `apps/web/app/api/projects/[id]/route.ts`
- Modify: `apps/web/components/projects/projects-center-client.tsx`
- Modify: `apps/web/components/projects/project-detail.tsx`
- Modify: `apps/web/tests/query-api.integration.test.ts`
- Modify: `apps/web/tests/merchant-project-admin.ui.test.tsx`

**Interfaces:**
- Consumes: latest successful `ProjectSnapshot` facts and shared operations filters.
- Produces: `ProjectListItem.merchantName` and actual `businessSource`.
- Produces: snapshot-specific detail keyed by `id`, `source`, and `dataDate`.

- [ ] **Step 1: Add failing project list assertions**

```ts
expect(result.items[0]).toMatchObject({
  id: 'P1::M1',
  merchantId: 'M1',
  merchantName: '示例装饰',
  businessSource: 'DESIGNBAO',
  assignedAt: '2026-08-20T00:00:00.000Z',
});
```

Add a Xiaohongshu-only row and assert a Designbao request excludes it while `ALL` includes both.

- [ ] **Step 2: Add the failing merchant-name UI assertion**

```tsx
expect(screen.getByRole('columnheader', { name: '装企' })).toBeInTheDocument();
expect(screen.getByText('示例装饰')).toBeInTheDocument();
expect(screen.getByText('M1')).toHaveClass('secondary-id');
expect(screen.queryByRole('columnheader', { name: '商家ID' })).not.toBeInTheDocument();
```

- [ ] **Step 3: Run project tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/merchant-project-admin.ui.test.tsx`

Expected: FAIL because Project Center reads the mixed `Project` table and returns no merchant name.

- [ ] **Step 4: Query filtered latest-batch snapshots**

Use `ProjectSnapshot.findMany` with `uploadBatchId`, resolved organization IDs, merchant ID, and source condition. Apply abnormal/coached/improved predicates to the snapshot fields. Select `merchant: { select: { name: true } }` and use snapshot `assignedAt`.

Cursor pagination uses a stable composite cursor encoded from `(projectId, businessSource)` for `ALL`; do not drop one source when two rows share a display project ID.

- [ ] **Step 5: Make project detail snapshot-specific**

The list opens:

```ts
const query = filters.toSearchParams({ dataDate: item.dataDate });
fetch(`/api/projects/${encodeURIComponent(item.id)}?${query}`);
```

The detail endpoint authorizes and reads the exact latest-batch/date/source snapshot, then returns merchant name, SOP fields, coaching fields, actual source, and matching source rule hits.

Filter current alerts to `version: 'v2'`; retain v1 hits only as historical database records.

- [ ] **Step 6: Update the filter bar and table presentation**

Render `OperationsFilterBar`, keep abnormal/coached/improved controls, and replace the merchant text cell with:

```tsx
<td>
  <strong>{item.merchantName || '未匹配装企'}</strong>
  <small className="secondary-id">{item.merchantId}</small>
</td>
```

Use the shared empty-state copy when no project matches.

Preserve the original `Project`-table list/detail functions as `legacyProjectListRepository` and `getLegacyProjectDetail`. Use them only while `SOURCE_AWARE_OPERATIONS_ENABLED` is false; tests must cover both modes.

- [ ] **Step 7: Run project tests**

Run: `pnpm exec vitest run apps/web/tests/query-api.integration.test.ts apps/web/tests/merchant-project-admin.ui.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/queries/projects.ts apps/web/lib/queries/request.ts apps/web/app/api/projects apps/web/components/projects apps/web/tests
git commit -m "feat: filter project center and show merchant names"
```

### Task 11: Move Metrics Center onto Shared Filters and Preserve Cross-Page State

**Files:**
- Modify: `apps/web/components/metrics/metrics-center-client.tsx`
- Modify: `apps/web/components/navigation/sidebar.tsx`
- Modify: `apps/web/components/dashboard/dashboard-view.tsx`
- Modify: `apps/web/components/merchants/merchant-detail.tsx`
- Modify: `apps/web/components/projects/project-detail.tsx`
- Modify: `apps/web/app/styles.css`
- Modify: `apps/web/tests/metrics-center.ui.test.tsx`
- Modify: `apps/web/tests/dashboard.ui.test.tsx`
- Modify: `apps/web/tests/merchant-project-admin.ui.test.tsx`
- Modify: `apps/web/e2e/metrics-center.spec.ts`
- Modify: `apps/web/e2e/operational-loop.spec.ts`

**Interfaces:**
- Consumes: `useOperationsFilters` and `OperationsFilterBar` from Task 7.
- Produces: one consistent filter experience and state-preserving navigation across all centers.

- [ ] **Step 1: Add failing Metrics Center shared-filter tests**

```tsx
expect(screen.getAllByLabelText('业务来源')).toHaveLength(1);
fireEvent.change(screen.getByLabelText('城市'), { target: { value: 'city-2' } });
await waitFor(() => expect(fetch).toHaveBeenCalledWith(
  expect.stringContaining('source=DESIGNBAO'),
));
expect(window.location.search).toContain('cityId=city-2');
```

- [ ] **Step 2: Add failing cross-link Playwright assertions**

```ts
await page.goto('/?source=XIAOHONGSHU&regionId=r1&cityId=c1');
await page.getByRole('link', { name: /异常项目/ }).click();
await expect(page).toHaveURL(/source=XIAOHONGSHU/);
await expect(page).toHaveURL(/regionId=r1/);
await expect(page).toHaveURL(/cityId=c1/);
```

- [ ] **Step 3: Run UI tests and verify failure**

Run: `pnpm exec vitest run apps/web/tests/metrics-center.ui.test.tsx apps/web/tests/dashboard.ui.test.tsx apps/web/tests/merchant-project-admin.ui.test.tsx`

Expected: FAIL because Metrics Center owns duplicate filter state and several links discard parameters.

- [ ] **Step 4: Replace Metrics Center's local organization/source state**

Remove its `source`, `regionId`, `cityId`, `merchantId`, and filter-options state. Use the shared controller and component while retaining metric IDs, grain, start, and end as Metrics-only URL state.

```ts
const operations = useOperationsFilters();
const organizationId = operations.value.cityId || operations.value.regionId;
query.set('source', operations.value.source);
```

- [ ] **Step 5: Preserve filters in all cross-page navigation**

Dashboard cards, merchant project links, project merchant links, and sidebar navigation all use a helper that merges current operations parameters with destination-specific parameters. Sidebar destinations preserve only the four global parameters, not Metrics-specific dates or metric IDs.

- [ ] **Step 6: Add shared styling and accessibility states**

Add focused classes for `.operations-filter-bar`, `.secondary-id`, `.rebuild-banner`, and `.operations-empty-state`. Every select keeps a visible label, disabled child selects remain readable, and loading/error messages use `aria-live="polite"`. Render `<RebuildBanner />` on Home, Metrics, Merchant, and Project Centers whenever the tagged rebuild is running or failed; while the rollout flag is false, all centers continue displaying legacy successful values.

- [ ] **Step 7: Run UI and e2e tests**

Run: `pnpm exec vitest run apps/web/tests/metrics-center.ui.test.tsx apps/web/tests/dashboard.ui.test.tsx apps/web/tests/merchant-project-admin.ui.test.tsx`

Expected: PASS.

Run: `pnpm test:e2e -- --grep "preserves operations filters|metrics source hierarchy"`

Expected: selected Playwright scenarios PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components apps/web/app/styles.css apps/web/tests apps/web/e2e
git commit -m "feat: preserve filters across operations centers"
```

### Task 12: Full Regression, Historical Rebuild, and Railway Rollout

**Files:**
- Modify: `packages/importer/tests/real-workbook.acceptance.test.ts`
- Modify: `apps/web/e2e/import-to-alert.spec.ts`
- Modify: `docs/runbooks/deploy-and-rollback.md`
- Modify: `docs/runbooks/import-recovery.md`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: executable acceptance checks and production runbook for migration, rebuild, verification, and rollback.

- [ ] **Step 1: Add the exact workbook acceptance assertion**

```ts
expect(metricValue({
  metricId: 'dispatch_project_count',
  source: 'DESIGNBAO',
  start: '2026-08-01',
  end: '2026-08-23',
})).toBe(561);
```

Also assert Xiaohongshu and `ALL` counts against values computed from the same parsed rows so future fixtures cannot silently mix `OTHER`.

- [ ] **Step 2: Extend the end-to-end operational loop**

The e2e test uploads the fixture, waits for IMPORT/METRICS/RULES success, then verifies:

```ts
await expect(page.getByLabel('业务来源')).toHaveValue('DESIGNBAO');
await expect(page.getByText('561')).toBeVisible();
await page.getByLabel('业务来源').selectOption('XIAOHONGSHU');
await expect(page.getByText('示例小红书装企')).toBeVisible();
await page.getByRole('link', { name: '项目中心' }).click();
await expect(page.getByRole('columnheader', { name: '装企' })).toBeVisible();
```

- [ ] **Step 3: Run the complete automated suite**

Run: `pnpm test`

Expected: all Vitest projects PASS.

Run: `pnpm typecheck`

Expected: all eight TypeScript project checks exit 0.

Run: `pnpm lint`

Expected: exit 0 with zero warnings.

Run: `pnpm build`

Expected: Next.js production build succeeds.

Run: `pnpm test:e2e`

Expected: all Playwright scenarios PASS.

- [ ] **Step 4: Update deployment and recovery runbooks**

Document this exact order:

```text
1. Back up PostgreSQL.
2. Set `SOURCE_AWARE_OPERATIONS_ENABLED=false` on the Web service.
3. Deploy the additive migration and source-writing Web/Worker build.
4. Confirm all four centers still use their legacy query paths.
5. Run `pnpm rebuild:business-source` once from a Railway one-off shell.
6. Wait until rebuild status reports completed = total and failed = 0.
7. Verify Designbao 2026-08-01..2026-08-23 dispatch project count = 561 through the source-aware acceptance query.
8. Verify three sampled merchants in Designbao, Xiaohongshu, and All.
9. Set `SOURCE_AWARE_OPERATIONS_ENABLED=true` and redeploy Web only.
10. Verify all four centers and retain the prior Web deployment for rollback.
```

Recovery instructions must state that a failed rebuild is retried by re-running the idempotent command; uploaded batches, project snapshots, manual decisions, and audit logs are never deleted.

- [ ] **Step 5: Commit verification and runbook changes**

```bash
git add packages/importer/tests/real-workbook.acceptance.test.ts apps/web/e2e/import-to-alert.spec.ts docs/runbooks
git commit -m "test: verify source-aware operations rollout"
```

- [ ] **Step 6: Push and verify GitHub CI or repository checks**

Run: `git push origin main`

Expected: the new commits appear on `weisl9597-bit/-` main and all configured checks pass.

- [ ] **Step 7: Deploy Web and Worker on Railway**

Set `SOURCE_AWARE_OPERATIONS_ENABLED=false`, then wait for both services to show a successful deployment from the same final commit. Verify:

```text
GET https://web-production-445d5c.up.railway.app/api/health → HTTP 200
Web service → Online
Worker service → Online
PostgreSQL → Online
```

- [ ] **Step 8: Run the production rebuild and acceptance checks**

Run `pnpm rebuild:business-source` once in a Railway shell with production `DATABASE_URL`. Do not re-upload the Excel file. Wait for all tagged METRICS and RULES jobs to succeed and verify the source-aware acceptance queries. Then set Web `SOURCE_AWARE_OPERATIONS_ENABLED=true`, redeploy Web, verify all four centers with Designbao, Xiaohongshu, and All filters, and confirm the Project Center merchant-name presentation.

- [ ] **Step 9: Record final deployment evidence**

Record the final commit SHA, Railway Web deployment ID, Worker deployment ID, rebuild totals, failed batch count, data date, and the verified Designbao count `561` in the task handoff. If any acceptance check fails, roll back the Web query switch and leave the last successful data visible while repairing the failed stage.

