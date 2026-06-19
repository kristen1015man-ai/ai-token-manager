import { NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { detectAnomalies } from "../../../../../lib/anomaly-detect";

export async function POST(request: Request) {
  const authError = requireInternalRequest(request);
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
        multiplier: a.multiplier === Infinity ? "Infinity" : a.multiplier.toFixed(1),
        effectiveThreshold: a.effectiveThreshold,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Anomaly check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
