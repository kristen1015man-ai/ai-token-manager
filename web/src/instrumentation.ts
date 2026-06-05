/**
 * Next.js Instrumentation Hook
 *
 * 服务器启动时自动执行，用于初始化定时飞书同步。
 * Next.js 15+ 默认启用此功能。
 */
export async function register() {
  // 仅在 Node.js 运行时执行（跳过 Edge）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAutoSync } = await import("./lib/auto-sync");
    startAutoSync();
  }
}
