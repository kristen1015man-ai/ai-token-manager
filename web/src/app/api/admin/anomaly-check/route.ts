import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { detectAnomalies } from "../../../../lib/anomaly-detect";

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

/**
 * POST /api/admin/anomaly-check
 * 手动/自动触发一次异常用量检测
 */
export async function POST(request: NextRequest) {
  const authError = await authenticate(request);
  if (authError) return authError;

  try {
    const result = await detectAnomalies();

    return NextResponse.json({
      success: true,
      checked: result.checked,
      anomalyCount: result.anomalies.length,
      skipped: result.skipped,
      anomalies: result.anomalies.map((a) => ({
        userName: a.userName,
        department: a.department,
        hourlyCost: a.hourlyCost,
        sevenDayAvgHourly: a.sevenDayAvgHourly,
        multiplier:
          a.multiplier === Infinity ? "∞" : a.multiplier.toFixed(1),
        effectiveThreshold: a.effectiveThreshold,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "异常检测失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
