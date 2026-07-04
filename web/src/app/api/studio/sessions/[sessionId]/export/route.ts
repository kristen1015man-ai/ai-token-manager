import { NextRequest, NextResponse } from "next/server";
import { requireActiveSession } from "../../../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../../../lib/db";
import { ensureStudioTables } from "../../../../../../lib/studio-db";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function escMd(s: string): string {
  // L9: 之前直接 return s 是 no-op，message.content 里的 `##`/`---`/`*` 会破坏导出文件结构
  // （标题层级错乱、消息边界混淆）。这里用 fenced code block 包裹，把整条消息当作纯文本，
  // 内部任何 markdown 排版字符都被去语义化。代价：丢失消息内本身合法的 markdown 渲染，
  // 但对话导出场景里"内容可被稳定还原"优先级高于"渲染美观"。
  // 三反引号定界符冲突防护：消息内含 ``` 时改用更长的 ~~~ 定界。
  if (s.includes("```")) {
    return "~~~\n" + s + "\n~~~";
  }
  return "```\n" + s + "\n```";
}

function tsToDate(seconds: number): string {
  try {
    const d = new Date(seconds * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return String(seconds);
  }
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { sessionId } = await context.params;
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "md").toLowerCase() === "json" ? "json" : "md";

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  ensureStudioTables(raw);

  const sessionRows = raw.exec(
    `SELECT id, title, default_model, mode, created_at, updated_at, project_path
     FROM studio_sessions
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [sessionId, session.userId]
  )[0]?.values ?? [];
  if (!sessionRows[0]) {
    return NextResponse.json({ error: "Studio session not found" }, { status: 404 });
  }
  const row = sessionRows[0];
  const sessionObj = {
    id: String(row[0]),
    title: String(row[1] ?? "New Studio Session"),
    defaultModel: row[2] ? String(row[2]) : null,
    mode: String(row[3] ?? "default"),
    createdAt: Number(row[4] ?? 0),
    updatedAt: Number(row[5] ?? 0),
    projectPath: row[6] ? String(row[6]) : null,
  };

  const messageRows = raw.exec(
    `SELECT id, role, content, metadata, created_at
     FROM studio_messages
     WHERE session_id = ? AND user_id = ?
     ORDER BY created_at ASC`,
    [sessionId, session.userId]
  )[0]?.values ?? [];
  const messages = messageRows.map((r) => ({
    id: String(r[0]),
    role: String(r[1]),
    content: String(r[2] ?? ""),
    createdAt: Number(r[4] ?? 0),
  }));

  if (format === "json") {
    const payload = {
      exportedAt: new Date().toISOString(),
      session: sessionObj,
      messages,
    };
    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(sessionObj.title).slice(0, 40) || "session"}.json"`,
      },
    });
  }

  // markdown
  const lines: string[] = [];
  lines.push(`# ${sessionObj.title}`);
  lines.push("");
  lines.push(`- 会话 ID: \`${sessionObj.id}\``);
  lines.push(`- 项目路径: ${sessionObj.projectPath || "(未指定)"}`);
  lines.push(`- 模型: ${sessionObj.defaultModel || "(默认)"}`);
  lines.push(`- 模式: ${sessionObj.mode}`);
  lines.push(`- 创建时间: ${tsToDate(sessionObj.createdAt)}`);
  lines.push(`- 更新时间: ${tsToDate(sessionObj.updatedAt)}`);
  lines.push(`- 消息数: ${messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const m of messages) {
    const who = m.role === "user" ? "🙋 用户" : m.role === "assistant" ? "🤖 Sparkloom" : `📎 ${m.role}`;
    lines.push(`## ${who} · ${tsToDate(m.createdAt)}`);
    lines.push("");
    lines.push(escMd(m.content || "(空消息)"));
    lines.push("");
  }
  const md = lines.join("\n");

  return new NextResponse(md, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(sessionObj.title).slice(0, 40) || "session"}.md"`,
    },
  });
}
