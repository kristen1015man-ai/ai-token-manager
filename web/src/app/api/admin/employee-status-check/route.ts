import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../lib/admin-check";
import { runEmployeeStatusCheck } from "../../../../lib/employee-status-check";

export async function POST() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const result = await runEmployeeStatusCheck();
    return NextResponse.json(result);
  } catch (error) {
    console.error("[EmployeeCheck] Error:", error);
    const message = error instanceof Error ? error.message : "Employee status check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
