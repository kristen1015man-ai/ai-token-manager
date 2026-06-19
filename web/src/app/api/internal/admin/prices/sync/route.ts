import { NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../../lib/internal-auth";
import { syncPricesFromOfficial } from "../../../../../../lib/price-sync";

export async function POST(request: Request) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  try {
    const result = await syncPricesFromOfficial();
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Price sync failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
