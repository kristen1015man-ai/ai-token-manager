# ---- Build Stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制 workspace 配置
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

# 安装依赖
RUN pnpm install --frozen-lockfile

# 复制源码
COPY shared/ shared/
COPY proxy/ proxy/

# 编译 TypeScript
RUN pnpm --filter proxy exec tsc --outDir dist || true

# ---- Production Stage ----
FROM node:20-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

# 只装生产依赖
RUN pnpm install --frozen-lockfile --prod

COPY shared/ shared/
COPY proxy/dist/ proxy/dist/
COPY proxy/src/ proxy/src/

WORKDIR /app/proxy

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "--experimental-strip-types", "src/index.ts"]
