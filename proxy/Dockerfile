# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY proxy/ proxy/

RUN pnpm --filter proxy build

# ---- Production Stage ----
FROM node:22-alpine AS runner
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY shared/package.json shared/
COPY proxy/package.json proxy/

RUN pnpm install --frozen-lockfile --prod

COPY shared/ shared/
COPY proxy/package.json proxy/
COPY --from=builder /app/proxy/dist proxy/dist

# DOCKER-01: run as non-root and pre-own mounted runtime volumes.
RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser && \
    mkdir -p /usage && chown appuser:appgroup /usage

WORKDIR /app/proxy

ENV NODE_ENV=production
EXPOSE 3001

USER appuser

CMD ["node", "dist/index.js"]
