import { NextRequest, NextResponse } from "next/server";
import { executeSync, type SyncResult } from "./execute-sync";
import { requireAdmin as requireFreshAdmin } from "../../../../lib/admin-check";

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
 * 认证检查：支持 INTERNAL_API_KEY Bearer token（auto-sync 调用）
 * 或管理员 session（手动触发）
 */
async function authenticate(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    // Internal API 调用 — 通过
    return null;
  }

  // 尝试 session 认证
  const { error: authError } = await requireFreshAdmin();
  return authError || null;
}

/**
 * GET /api/setup/sync-feishu → 查看同步状态
 */
export async function GET(request: NextRequest) {
  const authError = await authenticate(request);
  if (authError) return authError;

  const shouldRun = request.nextUrl.searchParams.get("run") === "1";
  if (shouldRun) {
    return NextResponse.json(
      { error: "GET is read-only. Use POST with { background: true } to start sync.", status: syncStatus },
      { status: 405, headers: { Allow: "GET, POST" } }
    );
  }

  return NextResponse.json(syncStatus);
}

/**
 * POST /api/setup/sync-feishu → 同步执行（适合 CLI 调用，长超时）
 */
export async function POST(request: NextRequest) {
  const authError = await authenticate(request);
  if (authError) return authError;

  let background = false;
  try {
    const body = await request.json();
    background = body?.background === true;
  } catch {
    background = false;
  }

  if (background) {
    if (syncStatus.running) {
      return NextResponse.json(
        { error: "同步已在运行中", status: syncStatus },
        { status: 409 }
      );
    }

    runSyncInBackground();
    return NextResponse.json({
      message: "同步已在后台启动",
      status: syncStatus,
    }, { status: 202 });
  }

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
