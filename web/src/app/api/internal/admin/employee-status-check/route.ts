import { NextResponse } from "next/server";
import { requireInternalRequest } from "../../../../../lib/internal-auth";
import { runEmployeeStatusCheck } from "../../../../../lib/employee-status-check";

export async function POST(request: Request) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  try {
    const result = await runEmployeeStatusCheck();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[EmployeeCheck/Internal] Error:", error);
    const message = error instanceof Error ? error.message : "Employee status check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
