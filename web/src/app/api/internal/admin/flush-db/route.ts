import { NextRequest, NextResponse } from "next/server";
import { saveDb } from "../../../../../lib/db";
import { requireInternalRequest } from "../../../../../lib/internal-auth";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  await saveDb();
  return NextResponse.json({
    success: true,
    flushedAt: new Date().toISOString(),
  });
}
