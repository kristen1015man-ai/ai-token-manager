import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { syncPricesFromOfficial } from "../../../../../lib/price-sync";

/**
 * 认证检查：支持 INTERNAL_API_KEY Bearer token（auto-sync 调用）
 * 或管理员 session（手动触发）
 */
async function authenticate(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    return null; // Internal API 调用 — 通过
  }

  const { error: authError } = await requireAdmin();
  return authError || null;
}

/** 手动/自动触发官网价格同步 */
export async function POST(request: NextRequest) {
  const authError = await authenticate(request);
  if (authError) return authError;

  try {
    const result = await syncPricesFromOfficial();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
