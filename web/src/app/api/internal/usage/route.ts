import { NextRequest, NextResponse } from "next/server";
import { getDb, scheduleSave } from "../../../../lib/db";
import { usageLogs } from "../../../../../../shared/schema";
import { randomBytes } from "crypto";

/**
 * POST /api/internal/usage
 * 内部端点：供 proxy 转发用量记录，避免双进程同时写 SQLite
 *
 * 认证：通过 INTERNAL_API_KEY 环境变量进行简单 token 校验
 * Body: { records: UsageRecord[] }
 */
export async function POST(request: NextRequest) {
  // 内部 API Key 校验
  const internalKey = process.env.INTERNAL_API_KEY;
  if (!internalKey) {
    console.error("[InternalAPI] INTERNAL_API_KEY not configured");
    return NextResponse.json({ error: "Internal API not configured" }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${internalKey}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { records?: unknown[] };
  try {
    body = await request.json();
  } catch {
    console.warn("[Internal/Usage] 无效的 JSON 请求体");
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return NextResponse.json({ error: "records must be a non-empty array" }, { status: 400 });
  }

  try {
    const { db } = await getDb();

    const values = records.map((r: unknown) => {
      const rec = r as Record<string, unknown>;
      return {
        id: (rec.id as string) || randomBytes(8).toString("hex"),
        userId: rec.userId as string,
        model: rec.model as string,
        inputTokens: (rec.inputTokens as number) ?? 0,
        outputTokens: (rec.outputTokens as number) ?? 0,
        totalTokens: (rec.totalTokens as number) ?? 0,
        cost: (rec.cost as number) ?? 0,
        channelId: rec.channelId as string,
        createdAt: rec.createdAt ? new Date(rec.createdAt as number) : new Date(),
      };
    });

    await db.insert(usageLogs).values(values);
    scheduleSave(); // 延迟批量写入，合并高频调用

    return NextResponse.json({ success: true, count: values.length });
  } catch (err) {
    console.error("[InternalAPI] Failed to record usage:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
