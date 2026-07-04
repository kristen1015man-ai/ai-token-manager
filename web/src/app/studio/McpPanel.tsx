"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plug, Plus, RefreshCw, Trash2, Pencil, X, Check } from "lucide-react";
import styles from "./studio.module.css";

// 任务 2 MCP 配置入口：管理本机 Claude Code / Claude Agent SDK 的 MCP servers
// 通过 agent GET/POST /claude/mcp-config 读写 ~/.claude.json（agent 端做路径/危险命令拦截）

interface McpServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

interface McpConfigResponse {
  servers: McpServer[];
  sources: Array<{ file: string; scope: string; exists: boolean; serverCount?: number; parseError?: boolean }>;
  note: string;
}

interface Props {
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

type EditState =
  | { mode: "idle" }
  | { mode: "add" }
  | { mode: "edit"; originalName: string };

interface FormState {
  name: string;
  command: string;
  args: string; // 一行一个 arg
  env: string;  // KEY=VALUE 一行一个
}

const EMPTY_FORM: FormState = { name: "", command: "", args: "", env: "" };

function parseArgs(text: string): string[] {
  return text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1);
    if (k) out[k] = v;
  }
  return out;
}

function serializeArgs(args: string[]): string {
  return (args || []).join("\n");
}

function serializeEnv(env: Record<string, string>): string {
  return Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join("\n");
}

export default function McpPanel({ agentBase, agentAuthHeaders, onError, onNotice }: Props) {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [sources, setSources] = useState<McpConfigResponse["sources"]>([]);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [edit, setEdit] = useState<EditState>({ mode: "idle" });
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    if (!agentBase) return;
    setLoading(true);
    try {
      const res = await fetch(`${agentBase}/claude/mcp-config`, {
        method: "GET",
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as McpConfigResponse;
      setServers(Array.isArray(data.servers) ? data.servers : []);
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setNote(String(data.note || ""));
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取 MCP 配置失败");
    } finally {
      setLoading(false);
    }
  }, [agentBase, agentAuthHeaders, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEdit({ mode: "idle" });
  }

  function startAdd() {
    setForm(EMPTY_FORM);
    setEdit({ mode: "add" });
  }

  function startEdit(s: McpServer) {
    setForm({ name: s.name, command: s.command, args: serializeArgs(s.args), env: serializeEnv(s.env) });
    setEdit({ mode: "edit", originalName: s.name });
  }

  async function submitForm() {
    if (!agentBase) return;
    const name = form.name.trim();
    const command = form.command.trim();
    if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
      onError("名称仅支持字母、数字、下划线、连字符");
      return;
    }
    if (!command) {
      onError("command 必填");
      return;
    }
    const payload = {
      action: edit.mode === "edit" ? "update" : "add",
      server: {
        name,
        command,
        args: parseArgs(form.args),
        env: parseEnv(form.env),
      },
    };
    setSaving(true);
    try {
      const res = await fetch(`${agentBase}/claude/mcp-config`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "mcp-config",
        }),
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      resetForm();
      await load();
      onNotice(`已${edit.mode === "edit" ? "更新" : "添加"} MCP server「${name}」`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存 MCP 配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function removeServer(name: string) {
    if (!agentBase) return;
    setSaving(true);
    try {
      const res = await fetch(`${agentBase}/claude/mcp-config`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "mcp-config",
        }),
        body: JSON.stringify({ action: "remove", server: { name } }),
      });
      const body = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await load();
      onNotice(`已删除 MCP server「${name}」`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "删除 MCP server 失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <Plug size={17} />
          <span>MCP Servers</span>
        </h3>
        <button
          type="button"
          className={styles.skillsInstallAll}
          onClick={load}
          disabled={loading}
          title="重新读取本机 MCP 配置"
        >
          {loading ? <Loader2 size={12} className={styles.spin} /> : <RefreshCw size={12} />}
          刷新
        </button>
      </div>

      {!agentBase && (
        <div className={styles.inspectorEmpty}>本机 Agent 未连接，无法读取 MCP 配置。</div>
      )}

      {agentBase && (
        <>
          {edit.mode === "idle" ? (
            <button type="button" className={styles.primaryAction} onClick={startAdd} style={{ marginBottom: 10 }}>
              <Plus size={13} /> 添加 MCP server
            </button>
          ) : (
            <div className={styles.mcpForm} data-popover>
              <div className={styles.mcpFormHead}>
                <strong>{edit.mode === "add" ? "添加 server" : `编辑 ${edit.originalName}`}</strong>
                <button type="button" className={styles.iconButton} onClick={resetForm} aria-label="取消">
                  <X size={14} />
                </button>
              </div>
              <label className={styles.mcpField}>
                <span>名称</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例如：filesystem"
                  disabled={edit.mode === "edit"}
                  maxLength={64}
                />
              </label>
              <label className={styles.mcpField}>
                <span>command</span>
                <input
                  value={form.command}
                  onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
                  placeholder="例如：npx"
                />
              </label>
              <label className={styles.mcpField}>
                <span>args（一行一个）</span>
                <textarea
                  value={form.args}
                  onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                  placeholder={"例如：\n-y\n@modelcontextprotocol/server-filesystem\n/path/to/dir"}
                  rows={4}
                />
              </label>
              <label className={styles.mcpField}>
                <span>env（KEY=VALUE 一行一个，可选）</span>
                <textarea
                  value={form.env}
                  onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                  placeholder={"例如：\nAPI_TOKEN=xxx"}
                  rows={3}
                />
              </label>
              <div className={styles.mcpFormActions}>
                <button type="button" className={styles.approvalDeny} onClick={resetForm} disabled={saving}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.approvalAllow}
                  onClick={() => void submitForm()}
                  disabled={saving}
                >
                  {saving ? <Loader2 size={13} className={styles.spin} /> : <Check size={13} />}
                  保存
                </button>
              </div>
            </div>
          )}

          {servers.length === 0 && edit.mode === "idle" ? (
            <div className={styles.inspectorEmpty}>暂无 MCP server。点击「添加 MCP server」开始。</div>
          ) : (
            <ul className={styles.mcpList}>
              {servers.map((s) => (
                <li key={s.name} className={styles.mcpItem}>
                  <div className={styles.mcpItemMeta}>
                    <strong>{s.name}</strong>
                    <code className={styles.mcpCommand}>{s.command} {s.args.join(" ")}</code>
                    {Object.keys(s.env || {}).length > 0 && (
                      <em className={styles.mcpEnvHint}>env: {Object.keys(s.env).join(", ")}</em>
                    )}
                  </div>
                  <div className={styles.mcpItemActions}>
                    <button type="button" className={styles.sessionRename} onClick={() => startEdit(s)} title="编辑">
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className={styles.sessionDelete}
                      onClick={() => void removeServer(s.name)}
                      title="删除"
                      disabled={saving}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {note && <p className={styles.skillsHint}>{note}</p>}
        </>
      )}
    </div>
  );
}
