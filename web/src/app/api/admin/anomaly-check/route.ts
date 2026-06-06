import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { detectAnomalies } from "../../../../lib/anomaly-detect";
import { apiHandlerNoBody } from "../../../../lib/api-handler";

/**
 * POST /api/admin/anomaly-check
 * 手动触发一次异常用量检测
 */
export const POST = apiHandlerNoBody(async () => {
  const { error } = await requireAdmin();
  if (error) return error;

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
});
