"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";
import { fetchApi, ApiError } from "@/lib/fetcher";
import styles from "./studio.module.css";

// 复用 StudioClient 的 StudioSession 形态（最小子集，避免循环依赖）
export type ImportedSession = {
  id: string;
  title: string;
  defaultModel: string | null;
  mode: string;
  createdAt: number;
  updatedAt: number;
  projectPath: string | null;
};

type Props = {
  disabled?: boolean;
  defaultModel: string;
  projectPath: string;
  collapsed?: boolean; // 侧栏折叠态：只显示图标
  onImported: (session: ImportedSession, messageCount: number) => void;
  onError: (message: string) => void;
  /** 命令面板等外部入口需要触发文件选择时，调用 inputRef.current.click() */
  inputRef?: React.MutableRefObject<HTMLInputElement | null>;
};

// 文件大小上限：10MB
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// 已知 export JSON 的形态（导出端点 /api/studio/sessions/[id]/export?format=json）：
//   { exportedAt, session: { id, title, ... }, messages: [{ id, role, content, createdAt }] }
type ExportJson = {
  session?: unknown;
  messages?: unknown;
  title?: unknown;
  // 用户手动构造的简化形态：直接 { messages: [...] }
};

function safeReadFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsText(file, "utf-8");
  });
}

function extractMessageList(raw: ExportJson): unknown[] | null {
  if (!raw || typeof raw !== "object") return null;
  const messages = (raw as { messages?: unknown }).messages;
  if (Array.isArray(messages)) return messages;
  return null;
}

function extractTitle(raw: ExportJson, fallback: string): string {
  const sess = (raw as { session?: { title?: unknown } }).session;
  if (sess && typeof sess === "object" && typeof sess.title === "string" && sess.title.trim()) {
    return sess.title.trim().slice(0, 80);
  }
  const direct = (raw as { title?: unknown }).title;
  if (typeof direct === "string" && direct.trim()) return direct.trim().slice(0, 80);
  return fallback;
}

// 把 markdown 导出文件解析为单条 assistant 消息（保留原文，前端 markdown 渲染）
// 导出 md 格式：# 标题\n## 🙁 用户 · 时间\n内容\n## 🤖 Sparkloom · 时间\n内容\n...
// 简化处理：原 md 作为单条 assistant 消息灌入，用户能在新会话里看到完整历史
function parseMarkdownAsMessages(md: string): { messages: Array<{ role: "user" | "assistant"; content: string }>; title: string } {
  // 提取首行 # 标题
  const titleMatch = md.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim().slice(0, 80) : "导入的 Markdown 会话";
  // 按 "## 🙁 用户" / "## 🤖 Sparkloom" 分割
  const sections = md.split(/^##\s+/m).filter((s) => s.trim().length > 0);
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const sec of sections) {
    // 跳过非消息段（如元信息列表）
    const isUser = sec.startsWith("🙋");
    const isAssistant = sec.startsWith("🤖");
    if (!isUser && !isAssistant) continue;
    // 去掉 "🙋 用户 · 时间\n" 这一行
    const lines = sec.split("\n");
    lines.shift();
    const content = lines.join("\n").trim();
    if (content) messages.push({ role: isUser ? "user" : "assistant", content: content.slice(0, 20_000) });
  }
  // 如果没切出消息，把整段 md 当一条 assistant 消息
  if (messages.length === 0) {
    messages.push({ role: "assistant", content: md.slice(0, 20_000) || "(空消息)" });
  }
  return { messages, title };
}

export default function ImportSessionButton({ disabled, defaultModel, projectPath, collapsed, onImported, onError, inputRef: externalInputRef }: Props) {
  const innerInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  // 外部传入的 ref 与内部 ref 同步指向同一个 input 元素
  useEffect(() => {
    if (externalInputRef) externalInputRef.current = innerInputRef.current;
  });

  function openPicker() {
    if (disabled || importing) return;
    innerInputRef.current?.click();
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // 重置 value 让同一文件可再次选择
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      onError(`文件过大（${(file.size / 1024 / 1024).toFixed(1)} MB），导入上限 10MB`);
      return;
    }

    const isJson = /\.json$/i.test(file.name);
    const isMd = /\.(md|markdown|txt)$/i.test(file.name);
    if (!isJson && !isMd) {
      onError("仅支持 .json 或 .md 文件");
      return;
    }

    setImporting(true);
    try {
      const text = await safeReadFile(file);
      let title = file.name.replace(/\.(json|md|markdown|txt)$/i, "").slice(0, 80) || "导入的会话";
      let messages: Array<{ role: "user" | "assistant"; content: string }> = [];

      if (isJson) {
        let parsed: ExportJson;
        try {
          parsed = JSON.parse(text) as ExportJson;
        } catch {
          throw new Error("JSON 格式错误，无法解析");
        }
        const msgList = extractMessageList(parsed);
        if (!msgList) throw new Error("未找到 messages 字段（应导出为 JSON 格式）");
        messages = msgList
          .map((m) => {
            if (!m || typeof m !== "object") return null;
            const obj = m as { role?: unknown; content?: unknown };
            const role: "user" | "assistant" = obj.role === "assistant" ? "assistant" : "user";
            const content = typeof obj.content === "string" ? obj.content.trim() : "";
            return content ? { role, content: content.slice(0, 20_000) } : null;
          })
          .filter((m): m is { role: "user" | "assistant"; content: string } => m !== null);
        title = extractTitle(parsed, title);
        if (messages.length === 0) throw new Error("文件中没有有效消息");
      } else {
        const result = parseMarkdownAsMessages(text);
        messages = result.messages;
        title = result.title;
      }

      const result = await fetchApi<{ session: ImportedSession; importedMessageCount: number }>("/api/studio/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          mode: "default",
          defaultModel: defaultModel || undefined,
          projectPath: projectPath.trim() || undefined,
          messages,
        }),
      });
      onImported(result.session, result.importedMessageCount);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : err instanceof Error ? err.message : "导入失败";
      onError(msg);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.importTaskButton} ${collapsed ? styles.importTaskCollapsed : ""}`}
        onClick={openPicker}
        disabled={disabled || importing}
        title="导入会话（.json 或 .md，仅历史回看，新发消息会开新 AI 会话）"
        aria-label="导入会话"
      >
        {importing ? <Loader2 size={16} className={styles.spin} /> : <Upload size={16} />}
        {!collapsed && <span>导入会话</span>}
      </button>
      <input
        ref={innerInputRef}
        type="file"
        accept=".json,.md,.markdown,.txt,application/json,text/markdown,text/plain"
        onChange={handleChange}
        className={styles.hiddenFileInput}
        aria-hidden="true"
        tabIndex={-1}
      />
    </>
  );
}
