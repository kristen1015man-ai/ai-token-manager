# ===== AI Token Manager - Web + API =====
# 单服务部署：Next.js 管理后台
# Railway 从根目录的 Dockerfile 构建
# v2: three-tier org structure (center/department/group)

# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/

RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY web/ web/

# Next.js standalone 构建
RUN cd web && pnpm next build

# ---- Production Stage ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# 复制 standalone 构建产物
COPY --from=builder /app/web/.next/standalone ./
COPY --from=builder /app/web/.next/static ./web/.next/static

# 复制 public 静态资源（logo 等）
COPY --from=builder /app/web/public ./web/public

# 数据目录（Railway Volume 挂载）— 确保 nextjs 用户有写权限
RUN mkdir -p /data && chown nextjs:nodejs /data
RUN apk add --no-cache su-exec

EXPOSE 3000

# 启动时先修复权限再运行
CMD ["sh", "-c", "if [ -d /data ]; then chown -R nextjs:nodejs /data 2>/dev/null || true; fi && su-exec nextjs node web/server.js"]
