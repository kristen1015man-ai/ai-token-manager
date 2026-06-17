import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

export function requireInternalRequest(request: NextRequest | Request): NextResponse | null {
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    console.error("[InternalAPI] INTERNAL_API_KEY not configured");
    return NextResponse.json({ error: "Internal API not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const expected = `Bearer ${internalKey}`;
  const providedBuffer = Buffer.from(authHeader);
  const expectedBuffer = Buffer.from(expected);

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
