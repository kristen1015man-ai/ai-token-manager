import { NextRequest, NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../../lib/internal-auth";
import { migrateSensitiveFields } from "../../../../../../lib/sensitive-field-migration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIRM_HEADER = "x-sparkloom-maintenance-confirm";
const CONFIRM_VALUE = "encrypt-sensitive-fields";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;
  if (request.headers.get(CONFIRM_HEADER) !== CONFIRM_VALUE) {
    return NextResponse.json({
      error: `Missing ${CONFIRM_HEADER}: ${CONFIRM_VALUE}`,
    }, { status: 400 });
  }

  try {
    const result = await migrateSensitiveFields();
    return NextResponse.json({
      success: true,
      migratedAt: new Date().toISOString(),
      details: result,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
