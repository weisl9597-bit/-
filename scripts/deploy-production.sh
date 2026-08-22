#!/usr/bin/env sh
set -eu

REPOSITORY_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
COMPOSE_FILE="$REPOSITORY_ROOT/infra/production/docker-compose.yml"
ENV_FILE="$REPOSITORY_ROOT/infra/production/.env.production"
BACKUP_DIRECTORY="$REPOSITORY_ROOT/backups"

if [ ! -f "$ENV_FILE" ]; then
  echo "缺少 $ENV_FILE" >&2
  exit 1
fi
if [ -z "${WEB_IMAGE:-}" ] || [ -z "${WORKER_IMAGE:-}" ]; then
  echo "WEB_IMAGE 和 WORKER_IMAGE 必须使用不可变版本标签" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIRECTORY"
BACKUP_FILE="$BACKUP_DIRECTORY/designbao-$(date -u +%Y%m%d-%H%M%S).dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d postgres minio
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres sh -c 'pg_dump --format=custom --no-owner --username="$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP_FILE"

WEB_IMAGE="$WEB_IMAGE" WORKER_IMAGE="$WORKER_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" pull web worker
WEB_IMAGE="$WEB_IMAGE" WORKER_IMAGE="$WORKER_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" run --rm migrate
WEB_IMAGE="$WEB_IMAGE" WORKER_IMAGE="$WORKER_IMAGE" docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d web worker

echo "发布完成；发布前备份：$BACKUP_FILE"
