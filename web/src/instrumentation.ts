/**
 * Next.js Instrumentation Hook
 *
 * 服务器启动时自动执行，用于初始化定时飞书同步。
 * Next.js 15+ 默认启用此功能。
 */
export async function register() {
  // 仅在 Node.js 运行时执行（跳过 Edge）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 启动时确保辅助表（model_prices、sync_blacklist、channels 列迁移）
    const { ensureAllTables } = await import("./lib/ensure-tables");
    await ensureAllTables();

    const { backfillApiKeyHash } = await import("./lib/backfill-api-key-hash");
    await backfillApiKeyHash();

    const { startAutoSync } = await import("./lib/auto-sync");
    startAutoSync();

    const { saveDb } = await import("./lib/db");
    const globalForShutdown = globalThis as typeof globalThis & { __webDbShutdownHook?: boolean };
    if (!globalForShutdown.__webDbShutdownHook) {
      globalForShutdown.__webDbShutdownHook = true;
      const flushAndExit = async (signal: string) => {
        console.log(`[Shutdown] ${signal} received, flushing web database...`);
        try {
          await saveDb();
        } catch (err) {
          console.error("[Shutdown] Failed to flush web database:", err);
        }
        process.exit(0);
      };
      process.on("SIGTERM", () => void flushAndExit("SIGTERM"));
      process.on("SIGINT", () => void flushAndExit("SIGINT"));
    }
  }
}
