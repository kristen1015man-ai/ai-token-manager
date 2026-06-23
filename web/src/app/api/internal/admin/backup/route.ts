import { NextRequest, NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { uploadVerifiedBackupToObjectStorage } from "../../../../../lib/object-storage-backup";
import { createVerifiedBackup } from "../../../../../lib/verified-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  try {
    const result = await createVerifiedBackup("internal-route");
    const objectStorage = await uploadVerifiedBackupToObjectStorage(result);
    return NextResponse.json({
      ...result,
      objectStorage,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
