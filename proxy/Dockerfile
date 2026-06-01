# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY proxy/ proxy/

# ---- Production Stage ----
FROM node:20-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

RUN pnpm install --frozen-lockfile --prod

COPY shared/ shared/
COPY proxy/ proxy/

# 创建数据目录
RUN mkdir -p /data

WORKDIR /app/proxy

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "--experimental-strip-types", "src/index.ts"]
