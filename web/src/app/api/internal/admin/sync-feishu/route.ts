import { NextRequest, NextResponse } from "next/server";
import { executeSync, type SyncResult } from "../../../setup/sync-feishu/execute-sync";
import { requireInternalRequest } from "../../../../../lib/internal-auth";

let syncStatus: {
  running: boolean;
  startedAt?: number;
  finishedAt?: number;
  progress: string;
  result?: SyncResult;
  error?: string;
} = { running: false, progress: "idle" };

export async function GET(request: NextRequest) {
  const authError = requireInternalRequest(request);
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

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
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
        { error: "Sync already running", status: syncStatus },
        { status: 409 }
      );
    }

    runSyncInBackground();
    return NextResponse.json({ message: "Sync started in background", status: syncStatus }, { status: 202 });
  }

  try {
    const result = await executeSync();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[Sync/Internal] Failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}

async function runSyncInBackground() {
  syncStatus = { running: true, startedAt: Date.now(), progress: "started" };
  try {
    const result = await executeSync();
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "completed",
      result,
    };
  } catch (error) {
    syncStatus = {
      running: false,
      startedAt: syncStatus.startedAt,
      finishedAt: Date.now(),
      progress: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
