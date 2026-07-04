# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY agent/package.json agent/

RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY web/ web/
COPY agent/ agent/
COPY scripts/package-agent.mjs scripts/package-agent.mjs

# Next.js standalone 构建
RUN pnpm agent:package
RUN cd web && pnpm next build

# ---- Production Stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static
COPY --from=builder /app/web/public ./web/public

# Create data and shared usage directories before named volumes are mounted.
RUN mkdir -p /data /usage && chown nextjs:nodejs /data /usage

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "web/server.js"]
