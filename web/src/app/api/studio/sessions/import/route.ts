import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../../lib/db";
import { ensureStudioTables } from "../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

// 单条消息内容上限（与 messages POST 路由保持一致）
const MESSAGE_CONTENT_MAX = 20_000;
// 单次导入消息条数上限（防止滥用 + WS 体积失控）
const MESSAGE_COUNT_MAX = 500;
// 标题上限
const TITLE_MAX = 80;
// 默认模式
const DEFAULT_MODE = "default";

function cleanTitle(value: unknown): string {
  const title = typeof value === "string" ? value.trim() : "";
  return title.slice(0, TITLE_MAX) || "导入的会话";
}

function cleanMode(value: unknown): string {
  if (value === "plan" || value === "auto" || value === "yolo") return value;
  return DEFAULT_MODE;
}

function optionalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next ? next.slice(0, max) : null;
}

type IncomingMessage = {
  role?: unknown;
  content?: unknown;
  createdAt?: unknown;
};

function cleanMessage(raw: unknown, index: number): { role: "user" | "assistant"; content: string; createdAt: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as IncomingMessage;
  const role: "user" | "assistant" = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : (index % 2 === 1 ? "assistant" : "user");
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!content) return null;
  const trimmed = content.slice(0, MESSAGE_CONTENT_MAX);
  let createdAt = typeof item.createdAt === "number" && Number.isFinite(item.createdAt) && item.createdAt > 0
    ? Math.floor(item.createdAt)
    : 0;
  if (!createdAt) createdAt = Math.floor(Date.now() / 1000);
  return { role, content: trimmed, createdAt };
}

// M17：服务端独立 body 大小限制。next.config.ts 的 serverActions.bodySizeLimit 只对 Server Actions 生效，
// 对 Route Handler 无效；request.json() 同步全量解析，几百 MB JSON 会内存耗尽。
// 上限取 12MB（略大于客户端 10MB 留余量），双重防护：
//   1) Content-Length 头预检（早剪枝，但可伪造）
//   2) 流式累加 request.body 字节，超阈值即 cancel 流并 413（真正可靠的防护）
const IMPORT_BODY_MAX_BYTES = 12 * 1024 * 1024;

class BodyTooLargeError extends Error {
  constructor() {
    super("BODY_TOO_LARGE");
    this.name = "BodyTooLargeError";
  }
}

async function readBoundedJson(request: NextRequest, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    throw new BodyTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) {
    // 退化路径（罕见：环境未暴露 body 流）：信任 Content-Length 后退到 text()
    const text = await request.text();
    if (text.length > maxBytes) throw new BodyTooLargeError();
    return JSON.parse(text);
  }
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let assembled = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        try { await reader.cancel(); } catch { /* 忽略取消异常 */ }
        throw new BodyTooLargeError();
      }
      assembled += decoder.decode(value, { stream: true });
    }
  }
  assembled += decoder.decode();
  return JSON.parse(assembled);
}

export async function POST(request: NextRequest) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  let body: unknown;
  try {
    body = await readBoundedJson(request, IMPORT_BODY_MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return NextResponse.json(
        { error: `导入文件过大（上限 ${Math.round(IMPORT_BODY_MAX_BYTES / (1024 * 1024))}MB）` },
        { status: 413 }
      );
    }
    // JSON 解析失败或读取异常
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = cleanTitle((body as { title?: unknown }).title);
  const mode = cleanMode((body as { mode?: unknown }).mode);
  const defaultModel = optionalText((body as { defaultModel?: unknown }).defaultModel, 160);
  const projectPath = optionalText((body as { projectPath?: unknown }).projectPath, 1024);

  const rawMessages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return NextResponse.json({ error: "导入文件没有可恢复的消息" }, { status: 400 });
  }
  if (rawMessages.length > MESSAGE_COUNT_MAX) {
    return NextResponse.json({ error: `导入消息数超过上限 ${MESSAGE_COUNT_MAX} 条，请裁剪后再导入` }, { status: 400 });
  }

  const messages: Array<{ role: "user" | "assistant"; content: string; createdAt: number }> = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const cleaned = cleanMessage(rawMessages[i], i);
    if (cleaned) messages.push(cleaned);
  }
  if (messages.length === 0) {
    return NextResponse.json({ error: "导入文件没有可恢复的消息" }, { status: 400 });
  }

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const sessionId = randomUUID();
  const baseTs = messages[0]?.createdAt ?? Math.floor(Date.now() / 1000);
  const now = Math.floor(Date.now() / 1000);

  // L7：session + messages + updated_at 三段一起包进事务，任一 INSERT/UPDATE 失败即 ROLLBACK，
  // 避免中途失败留"session 已建但只插入部分消息"的脏状态被 saveDb 落盘。
  raw.run("BEGIN");
  try {
    // 1) 创建 session
    raw.run(
      `INSERT INTO studio_sessions (id, user_id, title, default_model, mode, created_at, updated_at, project_path)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [sessionId, session.userId, title, defaultModel, mode, baseTs, now, projectPath]
    );

    // 2) 批量插入 messages（保持导入时间顺序；createdAt 单调递增以兼容按时间排序的查询）
    let prevTs = baseTs;
    for (const m of messages) {
      // 若导入消息的 createdAt 比前一条还早（或相等），强制 +1 保证单调
      if (m.createdAt <= prevTs) m.createdAt = prevTs + 1;
      prevTs = m.createdAt;
      raw.run(
        `INSERT INTO studio_messages (id, session_id, user_id, role, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [randomUUID(), sessionId, session.userId, m.role, m.content, JSON.stringify({ source: "import" }), m.createdAt]
      );
    }
    raw.run("UPDATE studio_sessions SET updated_at = ? WHERE id = ? AND user_id = ?", [now, sessionId, session.userId]);
    raw.run("COMMIT");
  } catch (e) {
    try { raw.run("ROLLBACK"); } catch { /* ignore */ }
    throw e;
  }
  await saveDb();

  return NextResponse.json(
    {
      session: {
        id: sessionId,
        title,
        defaultModel,
        mode,
        createdAt: baseTs,
        updatedAt: now,
        projectPath,
      },
      importedMessageCount: messages.length,
    },
    { status: 201 }
  );
}
