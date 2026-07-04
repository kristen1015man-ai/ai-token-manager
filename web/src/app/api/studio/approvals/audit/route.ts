import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../lib/db";
import { ensureStudioTables } from "../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

const ALLOWED_DECISIONS = new Set(["allow", "deny"]);

// J-2 审批密钥审计日志：前端在 respondApproval 时 fire-and-forget 调用，
// 记录每次 approve/deny 的工具名/风险/输入摘要，供后续审计追溯
export async function POST(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const body = await request.json().catch(() => ({}));
  const approvalId = typeof body.approvalId === "string" ? body.approvalId.slice(0, 128) : "";
  const decisionRaw = String(body.decision || "").toLowerCase();
  const decision = ALLOWED_DECISIONS.has(decisionRaw) ? decisionRaw : "deny";
  if (!approvalId) {
    return NextResponse.json({ error: "approvalId is required" }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 128) : null;
  const toolName = typeof body.toolName === "string" ? body.toolName.slice(0, 128) : null;
  const risk = typeof body.risk === "string" ? body.risk.slice(0, 16) : null;
  // 输入摘要做长度限制（避免泄露完整敏感参数，同时保留审计线索）
  const inputSummary = typeof body.inputSummary === "string" ? body.inputSummary.slice(0, 200) : null;
  const now = Math.floor(Date.now() / 1000);
  const id = randomUUID();

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  raw.run(
    `INSERT INTO studio_approval_logs (id, user_id, session_id, approval_id, decision, tool_name, risk, input_summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, session.userId, sessionId, approvalId, decision, toolName, risk, inputSummary, now]
  );
  await saveDb();

  return NextResponse.json({ ok: true, id, createdAt: now }, { status: 201 });
}
