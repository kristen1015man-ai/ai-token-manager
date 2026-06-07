import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { executeSync, type SyncResult } from "./execute-sync";

// 全局同步状态（同一时间只有一个同步在跑）
let syncStatus: {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  progress: string;
  result?: SyncResult;
  error?: string;
} = { running: false, progress: "idle" };

/**
 * GET /api/setup/sync-feishu → 查看同步状态
 * GET /api/setup/sync-feishu?run=1 → 启动后台同步，立即返回
 */
export async function GET(request: NextRequest) {
  // 鉴权：仅管理员可触发同步
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  const shouldRun = request.nextUrl.searchParams.get("run") === "1";

  if (!shouldRun) {
    return NextResponse.json(syncStatus);
  }

  if (syncStatus.running) {
    return NextResponse.json(
      { error: "同步已在运行中", status: syncStatus },
      { status: 409 }
    );
  }

  // 启动后台同步（不 await）
  runSyncInBackground();

  return NextResponse.json({
    message: "同步已在后台启动",
    status: syncStatus,
  }, { status: 202 });
}

/**
 * POST /api/setup/sync-feishu → 同步执行（适合 CLI 调用，长超时）
 */
export async function POST(request: NextRequest) {
  // 鉴权：仅管理员可触发同步
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  try {
    const result = await executeSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Sync] 同步失败:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "同步失败" },
      { status: 500 }
    );
  }
}

async function runSyncInBackground() {
  syncStatus = { running: true, startedAt: Date.now(), progress: "开始同步..." };
  try {
    const result = await executeSync();
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "完成",
      result,
    };
  } catch (error) {
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "失败",
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}
