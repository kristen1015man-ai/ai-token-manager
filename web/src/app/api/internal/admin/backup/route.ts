import { NextRequest, NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { createVerifiedBackup } from "../../../../../lib/verified-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  try {
    const result = await createVerifiedBackup("internal-route");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
