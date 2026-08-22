# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS application
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/importer/package.json packages/importer/package.json
COPY packages/metrics/package.json packages/metrics/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @designbao/db generate && pnpm build

ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
EXPOSE 3000
CMD ["pnpm", "--filter", "@designbao/web", "start"]

