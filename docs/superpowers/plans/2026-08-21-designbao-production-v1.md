# 设计宝运营预警工作台生产 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的静态原型建设为支持每日 Excel 更新、指标计算、商家分类、异常预警和组织权限的生产 V1 系统。

**Architecture:** 使用 TypeScript 单仓库，Next.js 负责页面与服务端 API，独立 Node 工作进程处理 Excel 导入、指标快照和规则计算，PostgreSQL 同时保存业务事实、不可变快照、作业和审计记录。原型作为交互和视觉基准，不直接复制其模拟数据实现；业务公式集中在独立领域包中，前台与工作进程调用同一套定义。

**Tech Stack:** Node.js 22 LTS、pnpm 10、TypeScript 5.9、Next.js 15.5、React 19.1、PostgreSQL 16、Prisma 6、Zod 4、ExcelJS 4.4、Vitest 3、Playwright 1.55、S3 兼容对象存储

**Spec:** `docs/superpowers/specs/2026-08-21-designbao-production-v1-design.md`

**Execution status (2026-08-21):** Tasks 1—12 are implemented and the automated quality gates pass. The deployable package is ready; an actual production cutover still requires a target server, production secrets, backup/UAT sign-off, and a corrected first Excel batch without blocking data errors.

## Global Constraints

- 时区固定为 `Asia/Shanghai`。
- 周口径固定为周日 00:00 至周六 23:59:59。
- 商家 ID、项目 ID 是导入匹配的稳定主键。
- 原始上传文件、原始行和成功快照必须可追溯；成功快照不可覆盖。
- “空白”“否”“0”是三种不同数据状态，不得在清洗时合并。
- SOP 达标必须严格同时满足“30min 内跟进=是、详细需求沟通/户型解析=是、硬约沟通/量房=否”。
- V1 指标中心必须支持实际数据文档中的 6 组 40 个指标，可全部勾选；1—8 个显示趋势图，9 个以上显示分组矩阵。
- 项目异常不设等级，仅使用需辅导、未改善、是否辅导空白三类事实规则。
- 商家正式分类每周更新；C 类候选必须人工确认。
- 所有数据查询必须在服务端应用组织权限。
- V1 不建设通用规则编辑器、任务闭环、消息通知和移动端专项版本。

## Target File Structure

```text
apps/
  web/
    app/                         # 页面与 Route Handlers
    components/                  # 通用 UI 与四个业务中心组件
    lib/                         # 会话、权限、查询客户端
    tests/                       # Web 集成测试
  worker/
    src/jobs/                    # 导入、指标、规则作业
    src/worker.ts                # PostgreSQL 作业领取循环
packages/
  db/
    prisma/schema.prisma         # 数据模型
    src/client.ts                # Prisma 客户端
  domain/
    src/types.ts                 # 统一领域类型
    src/period.ts                # 日/周/月口径
    src/sop.ts                   # SOP 达标公式
  importer/
    src/mappings.ts              # Excel 表头映射
    src/parse-workbook.ts        # 解析与标准化
    src/validate-batch.ts        # 阻断错误与警告
  metrics/
    src/catalog.ts               # 40 个指标定义
    src/calculate.ts             # 分子/分母与聚合
    src/snapshots.ts             # 快照生成
  rules/
    src/project-alerts.ts        # 三类项目异常
    src/merchant-classification.ts
    src/evaluate.ts              # 优先级、命中与原因
  test-fixtures/
    excel/                       # 脱敏样例与错误样例
infra/
  docker-compose.yml             # PostgreSQL 与本地对象存储
  migrations/                    # 部署迁移说明
docs/
  runbooks/import-recovery.md
  runbooks/deploy-and-rollback.md
  data-dictionary.md
```

---

### Task 1: 工程基础、质量门禁与本地环境

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Create: `infra/docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `apps/web/app/api/health/route.ts`
- Create: `apps/web/tests/health.test.ts`

**Interfaces:**
- Produces: `GET /api/health -> { status: 'ok', database: 'ok', version: string }`。
- Produces: 根命令 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`。

- [ ] **Step 1: 写健康检查失败测试**

```ts
it('returns application and database health', async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({ status: 'ok', database: 'ok' });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest apps/web/tests/health.test.ts`

Expected: FAIL，`GET` 尚未定义。

- [ ] **Step 3: 建立工作区和最小健康接口**

```ts
export async function GET() {
  await db.$queryRaw`SELECT 1`;
  return Response.json({ status: 'ok', database: 'ok', version: process.env.APP_VERSION ?? 'dev' });
}
```

本地编排只启动 PostgreSQL 与 S3 兼容对象存储，不引入 Redis。

- [ ] **Step 4: 建立 CI 质量门禁**

CI 顺序固定为：安装锁定依赖 → Prisma 校验 → lint → typecheck → unit/integration test → build。任何一步失败时不得生成部署产物。

- [ ] **Step 5: 运行并提交**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm --filter web build`

Expected: 全部 PASS。

Commit: `chore: scaffold production workspace and quality gates`

### Task 2: 数据库模型、时间口径与审计基础

**Files:**
- Create: `packages/db/prisma/schema.prisma`
- Create: `packages/db/src/client.ts`
- Create: `packages/domain/src/types.ts`
- Create: `packages/domain/src/period.ts`
- Create: `packages/domain/src/sop.ts`
- Create: `packages/domain/tests/period.test.ts`
- Create: `packages/domain/tests/sop.test.ts`
- Create: `packages/db/tests/schema.integration.test.ts`

**Interfaces:**
- Produces: `getPeriodBounds(date: Date, grain: 'DAY'|'WEEK'|'MONTH'): { start: Date; end: Date; label: string }`。
- Produces: `isSopCompliant(input: SopFields): boolean`。
- Produces: Spec 第 5 节列出的数据库表和唯一约束。

- [ ] **Step 1: 写周口径和 SOP 失败测试**

```ts
expect(getPeriodBounds(new Date('2026-08-21T10:00:00+08:00'), 'WEEK')).toMatchObject({
  start: new Date('2026-08-16T00:00:00+08:00'),
  end: new Date('2026-08-22T23:59:59.999+08:00'),
});
expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: true, hardInvite: false })).toBe(true);
expect(isSopCompliant({ followWithin30m: true, needsAnalyzed: true, hardInvite: true })).toBe(false);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm vitest packages/domain/tests`

Expected: FAIL，时间与 SOP 函数尚未定义。

- [ ] **Step 3: 定义数据库约束**

关键唯一键：

```prisma
@@unique([dataDate, projectId], name: "project_snapshot_per_day")
@@unique([metricId, grain, periodStart, organizationId, merchantId], name: "metric_snapshot_grain")
@@unique([batchId, sourceSheet, sourceRow], name: "upload_source_row")
```

比例指标保存 `value`、`numerator`、`denominator`；分母为 0 时 `value` 必须为 `null`。

- [ ] **Step 4: 生成迁移并运行集成测试**

Run: `pnpm prisma migrate dev --name initial-domain`

Run: `pnpm vitest packages/db/tests/schema.integration.test.ts`

Expected: 重复项目日快照被数据库拒绝；审计表可保存操作前后 JSON。

- [ ] **Step 5: 提交**

Commit: `feat: add operational data model and canonical period rules`

### Task 3: 登录、角色与组织范围

**Files:**
- Create: `apps/web/lib/auth/session.ts`
- Create: `apps/web/lib/auth/password.ts`
- Create: `apps/web/lib/auth/scope.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/app/login/page.tsx`
- Create: `apps/web/app/api/session/route.ts`
- Create: `apps/web/tests/auth-scope.integration.test.ts`

**Interfaces:**
- Produces: `requireSession(): Promise<AppSession>`。
- Produces: `getOrganizationScope(userId: string): Promise<{ organizationIds: string[]; role: Role }>`。
- Produces: `applyOrganizationScope(where, scope): PrismaWhere`，供所有查询复用。

- [ ] **Step 1: 写越权失败测试**

```ts
it('prevents a city manager from querying another city', async () => {
  const scope = await getOrganizationScope(cityUser.id);
  expect(scope.organizationIds).toEqual([shenzhen.id]);
  expect(applyOrganizationScope({}, scope)).toEqual({ organizationId: { in: [shenzhen.id] } });
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/auth-scope.integration.test.ts`

Expected: FAIL，权限函数尚未定义。

- [ ] **Step 3: 实现数据库会话和组织范围**

密码只保存 Argon2id 哈希；会话 Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax`。管理员返回全部组织，大区负责人返回大区及后代城市，城市负责人只返回被授权城市。

- [ ] **Step 4: 保护页面和 API**

未登录访问业务页面跳转 `/login`；API 返回 401。已登录但越权返回 403，不返回目标对象是否存在的信息。

- [ ] **Step 5: 验证并提交**

Run: `pnpm vitest apps/web/tests/auth-scope.integration.test.ts`

Commit: `feat: add authenticated organization-scoped access`

### Task 4: Excel 映射、解析与数据质量报告

**Files:**
- Create: `packages/importer/src/mappings.ts`
- Create: `packages/importer/src/parse-workbook.ts`
- Create: `packages/importer/src/validate-batch.ts`
- Create: `packages/importer/src/hash-file.ts`
- Create: `packages/importer/tests/parse-workbook.test.ts`
- Create: `packages/importer/tests/validate-batch.test.ts`
- Create: `packages/test-fixtures/excel/designbao-valid.xlsx`
- Create: `packages/test-fixtures/excel/designbao-invalid.xlsx`
- Create: `docs/data-dictionary.md`

**Interfaces:**
- Produces: `parseWorkbook(buffer: Buffer): ParsedWorkbook`。
- Produces: `validateBatch(parsed: ParsedWorkbook): { records: CanonicalProjectRow[]; errors: ImportIssue[]; warnings: ImportIssue[] }`。
- Produces: `sha256(buffer: Buffer): string`。

- [ ] **Step 1: 固化统一字段和表头别名**

```ts
export const projectColumns = {
  projectId: ['项目ID', '项目id'],
  merchantId: ['商家ID', '商户ID'],
  assignedAt: ['分派时间'],
  followWithin30m: ['30min内跟进', '30分钟内跟进'],
  needsAnalyzed: ['详细需求沟通/户型解析'],
  hardInvite: ['硬约沟通/量房'],
  needsCoaching: ['是否需辅导', '需辅导项目'],
  coached: ['是否辅导'],
  improved: ['是否改善', '改善情况'],
} as const;
```

`docs/data-dictionary.md` 同时记录字段类型、是否必填、允许值和空白含义。

- [ ] **Step 2: 写有效与无效工作簿测试**

测试必须覆盖：商家 ID 缺失、项目 ID 重复、非法日期、未知城市、`是否辅导`空白保留为 `null`、`否`转换为 `false`。

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm vitest packages/importer/tests`

Expected: FAIL，解析器尚未实现。

- [ ] **Step 4: 实现解析与整批校验**

阻断错误代码固定为 `MISSING_ID`、`DUPLICATE_PROJECT_ID`、`INVALID_DATE`、`UNKNOWN_ORGANIZATION`、`INVALID_ENUM`；警告代码固定为 `OPTIONAL_VALUE_MISSING`、`SUMMARY_MISMATCH`。

- [ ] **Step 5: 验证并提交**

Run: `pnpm vitest packages/importer/tests`

Commit: `feat: parse and validate designbao Excel batches`

### Task 5: 上传 API、异步作业与幂等入库

**Files:**
- Create: `apps/web/app/api/admin/uploads/route.ts`
- Create: `apps/web/app/api/admin/uploads/[id]/route.ts`
- Create: `apps/worker/src/worker.ts`
- Create: `apps/worker/src/jobs/import-batch.ts`
- Create: `packages/db/src/jobs.ts`
- Create: `apps/worker/tests/import-batch.integration.test.ts`
- Create: `apps/web/tests/upload-api.integration.test.ts`

**Interfaces:**
- Produces: `POST /api/admin/uploads -> { batchId: string; status: 'QUEUED' }`。
- Produces: `GET /api/admin/uploads/:id -> UploadBatchResult`。
- Produces: `claimNextJob(workerId: string): Promise<Job | null>`，使用 `FOR UPDATE SKIP LOCKED`。

- [ ] **Step 1: 写重复文件和失败批次测试**

```ts
expect(await upload(validFile)).toMatchObject({ status: 'QUEUED' });
expect((await upload(validFile)).status).toBe(409);
expect(await latestSuccessfulDataDate()).toEqual(previousDateAfterInvalidUpload);
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/upload-api.integration.test.ts apps/worker/tests/import-batch.integration.test.ts`

Expected: FAIL，上传路由与作业处理器尚未定义。

- [ ] **Step 3: 实现上传与对象存储**

接口限制 `.xlsx`、50 MB；先计算 SHA-256，再保存原始文件并创建批次。响应不等待解析完成。

- [ ] **Step 4: 实现事务化导入**

```ts
await db.$transaction(async (tx) => {
  await persistRawRows(tx, batch, parsed.rows);
  if (errors.length) return markBatchFailed(tx, batch.id, errors);
  await upsertMerchantsAndProjects(tx, records);
  await insertProjectSnapshots(tx, batch.dataDate, records);
  await enqueueDownstreamJobs(tx, batch.id, ['METRICS', 'RULES']);
});
```

相同 `batchId` 重试时不得重复写入快照。

- [ ] **Step 5: 验证并提交**

Run: `pnpm vitest apps/web/tests/upload-api.integration.test.ts apps/worker/tests/import-batch.integration.test.ts`

Commit: `feat: add auditable asynchronous Excel ingestion`

### Task 6: 40 个指标目录、计算公式与周期快照

**Files:**
- Create: `packages/metrics/src/catalog.ts`
- Create: `packages/metrics/src/calculate.ts`
- Create: `packages/metrics/src/snapshots.ts`
- Create: `packages/metrics/src/query.ts`
- Create: `packages/metrics/tests/catalog.test.ts`
- Create: `packages/metrics/tests/calculate.test.ts`
- Create: `packages/metrics/tests/snapshots.integration.test.ts`
- Create: `apps/worker/src/jobs/calculate-metrics.ts`

**Interfaces:**
- Produces: `metricCatalog: readonly MetricDefinition[]`，长度严格为 40。
- Produces: `calculateMetric(definition, rows): MetricResult`。
- Produces: `buildMetricSnapshots(dataDate, batchId): Promise<number>`。
- Produces: `queryMetricSeries(query: MetricQuery): Promise<MetricSeries[]>`。

- [ ] **Step 1: 写目录完整性测试**

```ts
expect(metricCatalog).toHaveLength(40);
expect(groupCounts(metricCatalog)).toEqual({
  dispatch_open: 8, open_pk: 2, conversion: 12,
  designer_sop: 6, group_sync: 6, chat_quality: 6,
});
expect(new Set(metricCatalog.map(m => m.id)).size).toBe(40);
```

- [ ] **Step 2: 写比例边界测试**

```ts
expect(rate(0, 0)).toEqual({ value: null, numerator: 0, denominator: 0 });
expect(rate(56, 100).value).toBe(56);
```

同时用样例批次核对 SOP 达标率分子与对应项目 ID。

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm vitest packages/metrics/tests`

Expected: FAIL，目录和计算器尚未定义。

- [ ] **Step 4: 实现可复算快照**

所有比例保存分子、分母和百分比；周/月快照从日事实重新聚合，不对百分比求平均。每条快照保存 `sourceBatchId` 和公式版本。

- [ ] **Step 5: 实现汇总值差异校验**

明细计算值与 Excel 汇总值绝对差超过 0.1 个百分点时生成 `SUMMARY_MISMATCH` 警告，但明细计算值仍作为正式值。

- [ ] **Step 6: 验证并提交**

Run: `pnpm vitest packages/metrics/tests`

Commit: `feat: calculate 40 metrics and immutable period snapshots`

### Task 7: 项目异常、商家分类与人工覆盖

**Files:**
- Create: `packages/rules/src/project-alerts.ts`
- Create: `packages/rules/src/merchant-classification.ts`
- Create: `packages/rules/src/evaluate.ts`
- Create: `packages/rules/src/reasons.ts`
- Create: `packages/rules/tests/project-alerts.test.ts`
- Create: `packages/rules/tests/merchant-classification.test.ts`
- Create: `apps/worker/src/jobs/evaluate-rules.ts`

**Interfaces:**
- Produces: `evaluateProjectAlerts(project: ProjectSnapshot): ProjectAlert[]`。
- Produces: `classifyMerchant(input: MerchantClassificationInput): ClassificationDecision`。
- Produces: `evaluateRules(dataDate, batchId): Promise<RuleEvaluationSummary>`。

- [ ] **Step 1: 写项目异常规则测试**

```ts
expect(evaluateProjectAlerts({ needsCoaching: true, coached: null, improved: false }))
  .toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'NEEDS_COACHING' }),
    expect.objectContaining({ code: 'NOT_IMPROVED' }),
    expect.objectContaining({ code: 'COACHING_BLANK' }),
  ]));
```

- [ ] **Step 2: 写分类状态表测试**

覆盖 A、A 风险、B 候选、B 14 天未改善、C 候选待确认、C 14 天挽回、14 天无分派已淘汰，以及优先级冲突。

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm vitest packages/rules/tests`

Expected: FAIL，规则函数尚未定义。

- [ ] **Step 4: 实现版本化决策**

```ts
export type ClassificationDecision = {
  suggested: 'A' | 'A_RISK' | 'B' | 'C_CANDIDATE' | 'ELIMINATED';
  requiresConfirmation: boolean;
  ruleVersion: 'v1';
  evidence: Array<{ metricId: string; value: number | null; comparison?: number }>;
  reason: string;
};
```

人工豁免有效期内跳过 B/C 判断，但生命周期淘汰仅在永久排除时跳过。

- [ ] **Step 5: 验证并提交**

Run: `pnpm vitest packages/rules/tests`

Commit: `feat: evaluate operational alerts and merchant lifecycle rules`

### Task 8: 服务端查询 API 与首页聚合

**Files:**
- Create: `apps/web/app/api/dashboard/route.ts`
- Create: `apps/web/app/api/metrics/route.ts`
- Create: `apps/web/app/api/merchants/route.ts`
- Create: `apps/web/app/api/merchants/[id]/route.ts`
- Create: `apps/web/app/api/projects/route.ts`
- Create: `apps/web/app/api/projects/[id]/route.ts`
- Create: `apps/web/lib/queries/dashboard.ts`
- Create: `apps/web/lib/queries/metrics.ts`
- Create: `apps/web/tests/query-api.integration.test.ts`

**Interfaces:**
- Produces: 首页、指标、商家、项目的分页 JSON API。
- Consumes: Task 3 的 `AppSession` 和组织范围，Task 6/7 的快照与规则命中。

- [ ] **Step 1: 写 API 合同测试**

```ts
expect(await getDashboard(cityUser)).toMatchObject({
  dataDate: '2026-08-21',
  summary: { merchantTotal: expect.any(Number), abnormalProjects: expect.any(Number) },
  alerts: { coaching: expect.any(Array), improvement: expect.any(Array), projects: expect.any(Array) },
});
```

同时断言比例指标返回 `value`、`numerator`、`denominator`，分页返回 `nextCursor`。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/query-api.integration.test.ts`

Expected: FAIL，查询服务尚未定义。

- [ ] **Step 3: 实现统一筛选合同**

时间、组织、分类、辅导、改善、项目状态使用 Zod 验证；未知指标 ID 返回 400；越权对象返回 404。

- [ ] **Step 4: 增加数据库查询预算测试**

首页请求不超过 12 条数据库查询；商家/项目列表使用游标分页，每页默认 50、最大 200。

- [ ] **Step 5: 验证并提交**

Commit: `feat: expose organization-scoped operational query APIs`

### Task 9: 应用外壳与首页运营预警工作台

**Files:**
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/app/(app)/page.tsx`
- Create: `apps/web/components/navigation/sidebar.tsx`
- Create: `apps/web/components/filters/global-filter.tsx`
- Create: `apps/web/components/dashboard/summary-cards.tsx`
- Create: `apps/web/components/dashboard/alert-cards.tsx`
- Create: `apps/web/components/dashboard/merchant-structure.tsx`
- Create: `apps/web/tests/dashboard.ui.test.tsx`

**Interfaces:**
- Consumes: `GET /api/dashboard`。
- Produces: 首页预警到商家/项目列表的带参链接。

- [ ] **Step 1: 写首页 UI 失败测试**

```tsx
render(<DashboardPage data={fixture} />);
expect(screen.getByText('辅导执行异常')).toBeVisible();
expect(screen.getByText('商家改善异常')).toBeVisible();
expect(screen.getByText('项目异常')).toBeVisible();
expect(screen.getByRole('link', { name: /查看异常项目/ })).toHaveAttribute('href', expect.stringContaining('abnormal=true'));
```

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/dashboard.ui.test.tsx`

- [ ] **Step 3: 以现有原型为视觉基准实现页面**

状态色、左侧导航、筛选标签、异常卡片和详情抽屉保持已确认信息层级；去除原型中的模拟文案和硬编码数量。

- [ ] **Step 4: 实现加载、空状态和失败状态**

无成功批次时显示“等待管理员上传首份数据”；查询失败提供重试，不用 0 代替未知数据。

- [ ] **Step 5: 验证并提交**

Commit: `feat: connect production dashboard to live operational data`

### Task 10: 指标中心单指标、多指标与全量矩阵

**Files:**
- Create: `apps/web/app/(app)/metrics/page.tsx`
- Create: `apps/web/components/metrics/metric-catalog.tsx`
- Create: `apps/web/components/metrics/single-metric-view.tsx`
- Create: `apps/web/components/metrics/comparison-view.tsx`
- Create: `apps/web/components/metrics/metric-matrix.tsx`
- Create: `apps/web/components/metrics/drill-table.tsx`
- Create: `apps/web/tests/metrics-center.ui.test.tsx`
- Create: `apps/web/e2e/metrics-center.spec.ts`

**Interfaces:**
- Consumes: `GET /api/metrics` 的目录、时间序列和下钻结果。
- Produces: URL 可复现状态 `metricIds`、`grain`、`start`、`end`、`organizationId`、`drillPath`。

- [ ] **Step 1: 写 40 项全选失败测试**

```tsx
await user.click(screen.getByRole('button', { name: '全选全部' }));
expect(screen.getByText('已选 40/40')).toBeVisible();
expect(screen.getAllByTestId('metric-matrix-item')).toHaveLength(40);
```

再覆盖 8 个指标显示折线、9 个指标切换矩阵、搜索和全选本组。

- [ ] **Step 2: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/metrics-center.ui.test.tsx`

- [ ] **Step 3: 实现单指标和多指标状态模型**

所有选择写入 URL；刷新、分享链接和浏览器后退后状态保持。不同单位默认使用趋势指数，用户可切换原始值和环比。

- [ ] **Step 4: 实现组织到项目下钻**

每次下钻保留指标与时间条件；项目层点击打开详情，关闭后返回原滚动位置。

- [ ] **Step 5: 浏览器验证并提交**

Run: `pnpm playwright test apps/web/e2e/metrics-center.spec.ts`

Commit: `feat: deliver full 40-metric analysis and drill-down experience`

### Task 11: 商家中心、项目中心与管理后台

**Files:**
- Create: `apps/web/app/(app)/merchants/page.tsx`
- Create: `apps/web/app/(app)/projects/page.tsx`
- Create: `apps/web/app/(app)/admin/uploads/page.tsx`
- Create: `apps/web/app/(app)/admin/merchant-decisions/page.tsx`
- Create: `apps/web/components/merchants/merchant-detail.tsx`
- Create: `apps/web/components/projects/project-detail.tsx`
- Create: `apps/web/components/admin/upload-result.tsx`
- Create: `apps/web/app/api/admin/merchant-overrides/route.ts`
- Create: `apps/web/tests/merchant-project-admin.ui.test.tsx`
- Create: `apps/web/e2e/operational-loop.spec.ts`

**Interfaces:**
- Produces: 商家筛选/详情/项目互跳、项目筛选/详情、上传历史、C 类确认与豁免接口。

- [ ] **Step 1: 写完整运营闭环失败测试**

浏览器路径固定为：首页未改善预警 → B 类商家 → 分类原因与 14 天观察 → 未达标项目 → SOP 三项事实 → 返回所属商家。

- [ ] **Step 2: 写管理员决策审计测试**

```ts
await confirmCandidate({ merchantId, reason: '城市负责人复核确认' }, adminSession);
expect(await auditLogFor(merchantId)).toMatchObject({
  action: 'CONFIRM_C_CLASS', actorId: adminSession.user.id,
  reason: '城市负责人复核确认',
});
```

- [ ] **Step 3: 运行并确认失败**

Run: `pnpm vitest apps/web/tests/merchant-project-admin.ui.test.tsx`

- [ ] **Step 4: 实现业务页面和权限限制**

非管理员不显示上传和人工调整入口；大区/城市负责人只看授权范围。人工调整必须填写原因，临时豁免必须填写结束日期。

- [ ] **Step 5: 浏览器验证并提交**

Run: `pnpm playwright test apps/web/e2e/operational-loop.spec.ts`

Commit: `feat: complete merchant project and admin operational loop`

### Task 12: 全链路验收、监控、备份与生产发布

**Files:**
- Create: `apps/web/e2e/import-to-alert.spec.ts`
- Create: `apps/web/e2e/access-control.spec.ts`
- Create: `apps/web/e2e/visual-regression.spec.ts`
- Create: `docs/runbooks/import-recovery.md`
- Create: `docs/runbooks/deploy-and-rollback.md`
- Create: `infra/backup/verify-backup.ts`
- Create: `apps/web/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `infra/production/docker-compose.yml`
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: 可重复的部署、回滚、导入恢复和备份恢复流程。
- Produces: 生产健康检查、错误日志和作业状态监控。

- [ ] **Step 1: 建立导入到预警的全链路测试**

测试上传脱敏 Excel、等待批次成功、核对 40 指标目录、SOP 分子明细、项目异常、B/C 建议和首页数量。

- [ ] **Step 2: 建立权限与视觉回归**

在管理员、大区负责人、城市负责人三种会话下运行越权测试；以 1440×900 和 1280×800 截图，断言无页面级横向溢出。

- [ ] **Step 3: 完整质量门禁**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm --filter web build`

Expected: 0 failures，构建产物生成成功。

- [ ] **Step 4: 进行脱敏数据 UAT**

管理员验收上传结果；至少 1 名大区负责人和 2 名城市负责人完成首页→商家→项目、指标→组织→项目两条路径。所有阻断问题在生产发布前关闭。

- [ ] **Step 5: 发布与冒烟验证**

按 `docs/runbooks/deploy-and-rollback.md` 执行数据库备份、迁移、Web/Worker 部署、健康检查、样例登录和核心页面冒烟。发布失败时回滚应用版本；迁移只能使用已验证的向后兼容脚本。

- [ ] **Step 6: 提交**

Commit: `chore: add production acceptance deployment and recovery runbooks`

---

## Delivery Schedule

以 2 名全栈开发 + 1 名产品/测试兼职参与为基准，生产 V1 预计 6 周：

| 周次 | 交付内容 | 对应任务 | 验收门槛 |
|---|---|---|---|
| 第 1 周 | 工程、数据模型、权限骨架 | 1—3 | 登录后只能看到授权组织；数据库迁移可重复执行 |
| 第 2 周 | Excel 解析、校验、上传作业 | 4—5 | 样例文件可导入，错误文件不污染正式数据 |
| 第 3 周 | 40 指标、周期快照、SOP 口径 | 6 | 指标与明细可复算，周日—周六口径正确 |
| 第 4 周 | 项目异常、A/B/C 与查询 API | 7—8 | 规则命中有原因、有版本、可追溯 |
| 第 5 周 | 首页、指标、商家、项目与管理页 | 9—11 | 两条核心下钻路径完成，40 指标可全选 |
| 第 6 周 | 全链路测试、UAT、部署与试运行 | 12 | 自动化通过、关键用户签收、可回滚 |

若只有 1 名全栈开发，建议按相同顺序安排 8—10 周，不通过压缩测试、数据校验或权限范围来缩短周期。

## Launch Gates

以下条件全部满足才进入正式试运行：

- 至少一份真实数据的脱敏副本通过导入并与 Excel 人工核对。
- 40 个指标名称、分组、单位、方向和月度结果由业务负责人签字确认。
- SOP“是、是、否”口径抽查 20 个项目，系统与人工判断一致。
- B/C/淘汰规则至少各准备 1 个可复现样例；C 类确认与审计可查看。
- 管理员、大区负责人、城市负责人三种权限完成越权测试。
- 数据库每日备份已启用，并实际完成一次恢复演练。
- 生产发布和回滚手册由执行人员走读通过。

## Phase 2 Backlog

生产 V1 稳定运行 2—4 周后再评估：通用规则配置器、辅导任务闭环、消息通知、多维商家标签、报表导出、第三方数据自动同步和移动端体验。
