import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { getUsdCnyRate, invalidateRateCache } from "../../../../lib/exchange-rate";

/** GET: 获取当前汇率 */
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const rate = await getUsdCnyRate();
  return NextResponse.json(rate);
}

/** POST: 手动刷新汇率缓存 */
export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  invalidateRateCache();
  const rate = await getUsdCnyRate();
  return NextResponse.json({ ...rate, refreshed: true });
}
