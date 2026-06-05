import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../lib/admin-check";
import { syncPricesFromOfficial } from "../../../../../lib/price-sync";

/** 手动触发官网价格同步 */
export async function POST() {
  const { error: authError } = await requireAdmin();
  if (authError) return authError;

  try {
    const result = await syncPricesFromOfficial();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
