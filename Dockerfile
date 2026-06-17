# ---- Build Stage ----
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY web/package.json web/
COPY proxy/package.json proxy/

RUN pnpm install --frozen-lockfile

COPY shared/ shared/
COPY web/ web/
COPY proxy/ proxy/

RUN cd web && pnpm next build
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

COPY --from=builder /app/web/.next/standalone ./standalone
COPY --from=builder /app/web/.next/static ./standalone/web/.next/static
COPY --from=builder /app/web/public ./standalone/web/public

COPY railway/start.mjs railway/start.mjs

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser && \
    mkdir -p /data /proxy-data && \
    chown -R appuser:appgroup /app /data /proxy-data

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV WEB_PORT_INTERNAL=3000
ENV PROXY_PORT=3001
ENV USAGE_QUEUE_FILE=/data/usage-queue.jsonl
ENV USAGE_DEAD_LETTER_FILE=/data/usage-dead-letter.jsonl
ENV MAX_REQUEST_BODY_BYTES=2097152
ENV MAX_CHAT_BODY_BYTES=2097152

USER appuser

CMD ["node", "railway/start.mjs"]
