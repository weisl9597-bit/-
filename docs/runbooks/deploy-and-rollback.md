# 生产发布、备份与回滚手册

## 发布前门槛

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e`、`pnpm build` 全部通过。
- `pnpm --filter @designbao/db validate` 通过。
- `.env.production` 已从示例复制，所有密码与 `SESSION_SECRET` 已替换。
- MinIO 镜像应在正式环境改成经过验证的固定版本或 digest，不能长期使用 `latest`。
- 真实数据阻断错误已修复；40 个指标和 SOP“是、是、否”口径已由业务复核。
- 已有数据库必须先完成备份，并在独立数据库做过一次恢复演练。

## 首次部署

在仓库根目录执行：

```bash
cp infra/production/.env.production.example infra/production/.env.production
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml config
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml build
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml up -d postgres minio
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml run --rm migrate
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml run --rm web pnpm bootstrap:admin
docker compose --env-file infra/production/.env.production -f infra/production/docker-compose.yml up -d web worker
```

管理员命令是幂等的；再次执行会重置该邮箱的管理员密码。执行后应从环境文件移除明文 `BOOTSTRAP_ADMIN_PASSWORD`，并限制该文件权限。

## 发布冒烟

1. 打开 `/api/health`，确认 `status=ok`、`database=ok`。
2. 管理员登录，确认能看到“数据上传”和“商家决策”。
3. 城市负责人登录，确认看不到管理入口，且不能访问其他城市数据。
4. 打开首页、指标中心、商家中心、项目中心。
5. 在指标中心全选 40 项，确认显示 `40/40` 和矩阵。
6. 用脱敏样例上传一批数据，确认批次完成并能下钻到项目。

## 数据库备份

每天至少一次使用 PostgreSQL custom 格式：

```bash
pg_dump --format=custom --no-owner --file=designbao-YYYYMMDD-HHMM.dump "$DATABASE_URL"
BACKUP_SHA256=<记录的哈希> pnpm tsx infra/backup/verify-backup.ts designbao-YYYYMMDD-HHMM.dump
```

每月至少做一次独立恢复演练：创建临时数据库、`pg_restore --exit-on-error`、核对用户/批次/项目/指标数量，最后只删除本次演练创建的临时数据库。备份文件和数据库卷不能位于同一块磁盘。

## 常规升级

1. 记录当前 `WEB_IMAGE`、`WORKER_IMAGE` 标签。
2. 完成数据库备份和校验。
3. 拉取新镜像，先执行 `migrate`。
4. 仅在迁移成功后更新 Web 和 Worker。
5. 完成上面的发布冒烟，并观察失败作业数至少 15 分钟。

## 应用回滚

若新版本页面或 Worker 异常，但数据库仍兼容：

1. 在 `.env.production` 将 `WEB_IMAGE`、`WORKER_IMAGE` 改回上一稳定标签。
2. 执行 `docker compose ... up -d web worker`。
3. 重新做健康检查与核心页面冒烟。

数据库迁移不执行自动向下回滚。迁移必须保持向后兼容；确需恢复数据库时，停止 Web/Worker，保留故障库副本，再恢复发布前备份。该操作会丢失备份时间点之后的数据，必须由业务负责人确认。

## 监控最低要求

- 每分钟检查 `/api/health`。
- 对 Worker 退出、连续失败作业、批次处理超过 10 分钟告警。
- PostgreSQL 磁盘使用率 70% 预警、85% 严重告警。
- MinIO 原始文件桶启用版本化或不可变备份策略。
