# 设计宝运营预警工作台原型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个包含首页、指标中心、商家中心和项目中心的可点击 MVP Web 原型，用模拟数据验证信息架构与下钻体验。

**Architecture:** 使用无构建步骤的原生 HTML、CSS 和 JavaScript ES Modules。数据、状态/筛选逻辑和页面渲染分别放在独立文件中；浏览器端只维护当前页面、筛选条件、下钻层级和详情面板状态。Node 内置测试覆盖筛选与导航状态，Playwright 覆盖核心用户路径并生成桌面截图用于视觉检查。

**Tech Stack:** HTML5、CSS3、JavaScript ES2022、Node.js `node:test`、Playwright

**Spec:** `docs/superpowers/specs/2026-08-21-designbao-operations-dashboard-design.md`

## Global Constraints

- 只实现前端演示，不连接真实后台。
- 使用本地模拟数据，刷新后回到默认视图。
- 四个主导航页面均可访问，且当前导航状态明确。
- 首页预警入口必须带筛选跳转到商家中心或项目中心。
- 指标中心必须支持指标、时间切换和组织到项目的下钻演示。
- 同一商家和项目在四个页面中的示例数据必须一致。
- 周口径文案固定为“周日—周六”。
- 正常/改善为绿色，关注/待辅导为橙色，异常/未改善为红色，中性信息为蓝灰色。
- 不实现数据上传、权限、规则配置、任务闭环、导出与生产部署。

---

### Task 1: 模拟数据与可测试状态逻辑

**Files:**
- Create: `prototype/data.js`
- Create: `prototype/state.js`
- Create: `prototype/tests/state.test.mjs`

**Interfaces:**
- Produces: `merchants`, `projects`, `metrics`, `summary` 数据集合。
- Produces: `createInitialState(): AppState`、`navigate(state, page, filters): AppState`、`filterMerchants(merchants, filters): Merchant[]`、`filterProjects(projects, filters): Project[]`、`drillMetric(state, node): AppState`、`clearDrill(state): AppState`。

- [ ] **Step 1: 写出状态与筛选的失败测试**

在 `prototype/tests/state.test.mjs` 中覆盖：初始页面为首页；首页“未改善”入口跳转商家中心并带入 `improvement=未改善`；项目异常入口带入 `abnormal=异常项目`；商家搜索与分类组合筛选；项目异常状态筛选；指标下钻面包屑逐级增加与清空。

- [ ] **Step 2: 运行测试并确认失败**

Run: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test prototype/tests/state.test.mjs`

Expected: FAIL，原因是 `prototype/state.js` 尚不存在。

- [ ] **Step 3: 实现一致的模拟数据**

在 `prototype/data.js` 中定义华南、华东、华北的城市、6 个商家和 10 个项目。至少包含：1 个 A→B 商家、1 个 B→A 商家、1 个 B→C 商家、应辅导未辅导商家、已辅导未改善商家，以及 SOP 三项执行明细不全的异常项目。

- [ ] **Step 4: 实现最小状态函数**

在 `prototype/state.js` 中使用纯函数实现导航、筛选、指标下钻和面包屑重置。所有空筛选值视为“全部”，搜索对商家名称、城市和项目 ID 执行不区分大小写的包含匹配。

- [ ] **Step 5: 运行测试并确认通过**

Run: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test prototype/tests/state.test.mjs`

Expected: PASS，0 failures。

### Task 2: 四页信息架构与视觉系统

**Files:**
- Create: `prototype/index.html`
- Create: `prototype/styles.css`
- Create: `prototype/render.js`
- Create: `prototype/tests/render.test.mjs`

**Interfaces:**
- Consumes: Task 1 的数据集合和 `AppState`。
- Produces: `renderApp(root, state, data): void`、`renderHome(state, data): string`、`renderMetrics(state, data): string`、`renderMerchants(state, data): string`、`renderProjects(state, data): string`。

- [ ] **Step 1: 写出四页结构的失败测试**

在 `prototype/tests/render.test.mjs` 中断言：首页 HTML 包含六个总览指标和三类今日关注；指标中心包含指标选择、时间选择、趋势区、组织对比与下钻提示；商家中心包含筛选区、列表关键字段；项目中心包含筛选区和 SOP/辅导/改善字段。

- [ ] **Step 2: 运行测试并确认失败**

Run: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test prototype/tests/render.test.mjs`

Expected: FAIL，原因是 `prototype/render.js` 尚不存在。

- [ ] **Step 3: 创建应用外壳**

在 `prototype/index.html` 中创建带左侧导航、顶部组织与更新时间、主内容区和详情抽屉容器的语义结构，引入 `styles.css` 与 `app.js` ES Module。

- [ ] **Step 4: 实现四页静态渲染函数**

在 `prototype/render.js` 中生成首页、指标中心、商家中心和项目中心的默认内容。表格行、预警卡、分类分布和组织排行均从 Task 1 模拟数据计算，不重复硬编码对象状态。

- [ ] **Step 5: 建立统一视觉系统**

在 `prototype/styles.css` 中定义侧栏、卡片、表格、标签、筛选器、趋势图、抽屉和空状态。使用 CSS 变量统一颜色、圆角与间距；适配 1280px 及以上桌面宽度，并为 900—1279px 提供紧凑布局。

- [ ] **Step 6: 运行结构测试并确认通过**

Run: `C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe --test prototype/tests/render.test.mjs`

Expected: PASS，0 failures。

### Task 3: 交互入口、详情闭环与浏览器验收

**Files:**
- Create: `prototype/app.js`
- Create: `prototype/tests/e2e.mjs`
- Create: `prototype/README.md`
- Modify: `prototype/render.js`
- Modify: `prototype/styles.css`

**Interfaces:**
- Consumes: Task 1 的状态函数与 Task 2 的 `renderApp`。
- Produces: 可点击导航、筛选、搜索、指标下钻、商家详情、项目详情及商家/项目互跳。

- [ ] **Step 1: 写出核心路径的浏览器失败测试**

在 `prototype/tests/e2e.mjs` 中启动本地静态服务并覆盖：主导航四页切换；首页点击“已辅导未改善”后商家中心展示筛选标签；首页点击异常项目后项目中心展示异常结果；指标中心从全国下钻到华南、深圳、商家、项目；打开商家详情后进入异常项目详情；从项目详情返回所属商家。

- [ ] **Step 2: 运行端到端测试并确认失败**

Run: 将 `NODE_PATH` 设为 bundled `node_modules` 后执行 `node prototype/tests/e2e.mjs`。

Expected: FAIL，原因是 `prototype/app.js` 尚未绑定交互。

- [ ] **Step 3: 实现事件委托与状态更新**

在 `prototype/app.js` 中统一监听 `data-action` 元素，调用纯状态函数后重绘。筛选、搜索、详情打开/关闭均保留当前页面上下文；从首页带入的筛选以可清除标签展示。

- [ ] **Step 4: 实现商家与项目详情**

在 `prototype/render.js` 中补充详情抽屉：商家详情展示分类原因、辅导/改善状态、近 14 天趋势和项目列表；项目详情展示基础信息、三项 SOP、运营状态、相关指标及所属商家摘要。

- [ ] **Step 5: 完善键盘和可读性体验**

为导航、卡片、表格行和抽屉关闭按钮提供可见焦点；抽屉打开时标题获得焦点，Escape 关闭抽屉；所有状态除颜色外同时显示文字标签。

- [ ] **Step 6: 运行全部自动化测试**

Run: `node --test prototype/tests/state.test.mjs prototype/tests/render.test.mjs`，随后运行 `node prototype/tests/e2e.mjs`。

Expected: 所有测试 PASS，0 failures。

- [ ] **Step 7: 生成并检查桌面截图**

使用 Playwright 以 1440×1000 截取首页、指标中心、商家详情和项目详情。检查无横向页面溢出、文字截断、遮挡、不可见焦点或状态色冲突；发现问题后仅调整相关 CSS 并重新截图验证。

- [ ] **Step 8: 编写查看说明**

在 `prototype/README.md` 中记录双击 `index.html` 的直接查看方式，以及使用 bundled Python 运行本地静态服务的稳定查看方式：`python -m http.server 4173 --directory prototype`，浏览器访问 `http://127.0.0.1:4173`。

