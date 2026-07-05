"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronLeft, Loader2, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import styles from "./studio.module.css";

// 任务 3 /agents 子 agent 可视化：管理 .claude/agents/*.md（项目级 + 全局）
// 走 agent /claude/agents-files、/claude/agents-file
// 新建 agent 时插入 frontmatter 模板

const DEFAULT_AGENT_TEMPLATE = `---
name: my-agent
description: 什么时候用这个 agent
tools: Read, Grep, Glob
---
（这里写 agent 的系统提示正文，告诉它角色、目标、输出格式。）
`;

interface AgentFileMeta {
  path: string;
  scope: "project" | "global";
  name: string;
  exists: boolean;
}

interface AgentsFilesResponse {
  files: AgentFileMeta[];
  configDir: string;
  globalAgentsDir: string;
  cwd: string | null;
}

interface Props {
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  projectPath: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onConfirm: (message: string, onConfirm: () => void) => void;
}

export default function AgentsPanel({ agentBase, agentAuthHeaders, projectPath, onError, onNotice, onConfirm }: Props) {
  const [files, setFiles] = useState<AgentFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<"project" | "global">("project");

  const load = useCallback(async () => {
    if (!agentBase) return;
    setLoading(true);
    try {
      const url = new URL(`${agentBase}/claude/agents-files`);
      if (projectPath) url.searchParams.set("cwd", projectPath);
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AgentsFilesResponse;
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取 agent 列表失败");
    } finally {
      setLoading(false);
    }
  }, [agentBase, agentAuthHeaders, projectPath, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFile(file: AgentFileMeta) {
    if (!agentBase) return;
    setSelectedPath(file.path);
    setDraft("");
    setOriginalContent("");
    setLoadingContent(true);
    try {
      const url = new URL(`${agentBase}/claude/agents-file`);
      url.searchParams.set("path", file.path);
      if (projectPath) url.searchParams.set("cwd", projectPath);
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { path: string; content: string };
      setDraft(data.content || "");
      setOriginalContent(data.content || "");
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取 agent 文件失败");
      setSelectedPath(null);
    } finally {
      setLoadingContent(false);
    }
  }

  async function saveFile() {
    if (!agentBase || !selectedPath) return;
    setSaving(true);
    try {
      const res = await fetch(`${agentBase}/claude/agents-file`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "agents-file",
        }),
        body: JSON.stringify({ path: selectedPath, content: draft, cwd: projectPath || undefined }),
      });
      const body = await res.json().catch(() => ({} as { error?: string; path?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setOriginalContent(draft);
      onNotice(`已保存 ${selectedPath}`);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function closeEditor() {
    setSelectedPath(null);
    setDraft("");
    setOriginalContent("");
  }

  function startCreate() {
    if (!agentBase) {
      onError("本机 Agent 未连接");
      return;
    }
    if (newScope === "project" && !projectPath.trim()) {
      onError("项目级 agent 需要先选择项目目录");
      return;
    }
    setCreating(true);
    setNewName("");
  }

  async function doCreate() {
    if (!agentBase) return;
    const cleanName = newName.trim().replace(/\.md$/i, "").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80);
    if (!cleanName) {
      onError("agent 名称不能为空");
      return;
    }
    const dir = newScope === "project"
      ? `${projectPath.trim()}/.claude/agents`
      : null;
    const target = dir ? `${dir}/${cleanName}.md` : `~/.sparkloom/claude-code/agents/${cleanName}.md`;
    onConfirm(
      `新建 agent：${target}\n（若文件已存在会被覆盖）`,
      () => void writeNew(cleanName),
    );
  }

  async function writeNew(cleanName: string) {
    if (!agentBase) return;
    setSaving(true);
    try {
      const scopeDir = newScope === "project"
        ? `${projectPath.trim()}/.claude/agents`
        : ""; // global 走 agent 自己的 configDir
      const body: { path: string; content: string; cwd?: string } = {
        path: scopeDir ? `${scopeDir}/${cleanName}.md` : `${cleanName}.md`,
        content: DEFAULT_AGENT_TEMPLATE,
        ...(newScope === "project" ? { cwd: projectPath.trim() } : {}),
      };
      const res = await fetch(`${agentBase}/claude/agents-file`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "agents-file",
        }),
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({} as { error?: string; path?: string }));
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      setCreating(false);
      onNotice(`已新建 agent：${cleanName}`);
      await load();
      // 打开新文件
      const targetPath = String(result.path || "");
      if (targetPath) {
        await openFile({ path: targetPath, scope: newScope, name: cleanName, exists: true });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "新建 agent 失败");
    } finally {
      setSaving(false);
    }
  }

  function deleteCurrent() {
    if (!selectedPath) return;
    onConfirm(
      `删除 agent 文件？\n${selectedPath}\n（此操作不可撤销，需要确认）`,
      () => void doDelete(),
    );
  }

  async function doDelete() {
    if (!agentBase || !selectedPath) return;
    setSaving(true);
    try {
      const url = new URL(`${agentBase}/claude/agents-file`);
      url.searchParams.set("path", selectedPath);
      if (projectPath) url.searchParams.set("cwd", projectPath);
      const res = await fetch(url.toString(), {
        method: "DELETE",
        headers: agentAuthHeaders({ "x-sparkloom-local-confirm": "agents-file" }),
      });
      const body = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      onNotice(`已删除 ${selectedPath}`);
      closeEditor();
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSaving(false);
    }
  }

  const dirty = draft !== originalContent;
  const selectedFile = files.find((f) => f.path === selectedPath);

  const grouped = useMemo(() => ({
    project: files.filter((f) => f.scope === "project"),
    global: files.filter((f) => f.scope === "global"),
  }), [files]);

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <Bot size={17} />
          <span>子 Agent 管理</span>
        </h3>
        <div className={styles.agentsHeaderActions}>
          <button
            type="button"
            className={styles.skillsInstallAll}
            onClick={startCreate}
            title="新建 agent"
          >
            <Plus size={12} /> 新建
          </button>
          <button
            type="button"
            className={styles.skillsInstallAll}
            onClick={() => void load()}
            disabled={loading}
            title="重新加载"
          >
            {loading ? <Loader2 size={12} className={styles.spin} /> : <RefreshCw size={12} />}
          </button>
        </div>
      </div>

      {!agentBase && (
        <div className={styles.inspectorEmpty}>本机 Agent 未连接，无法读取子 agent 文件。</div>
      )}

      {agentBase && selectedPath === null && !creating && (
        <>
          <p className={styles.skillsHint}>
            管理 <code>.claude/agents/*.md</code>。修改后下次 Claude Code 启动时生效。
          </p>
          {!projectPath.trim() && (
            <p className={styles.skillsHint}>未选择项目目录时仅显示全局 agent。</p>
          )}
          {grouped.project.length > 0 && (
            <div className={styles.memoryGroup}>
              <span className={styles.memoryGroupTitle}>项目级</span>
              <ul className={styles.memoryList}>
                {grouped.project.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`${styles.memoryItem} ${f.exists ? "" : styles.memoryMissing}`}
                      onClick={() => void openFile(f)}
                      title={f.path}
                    >
                      <div className={styles.memoryItemHead}>
                        <strong>{f.name}</strong>
                        <em>{f.scope}</em>
                      </div>
                      <code className={styles.memoryPathLine}>{f.path}</code>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={styles.memoryGroup}>
            <span className={styles.memoryGroupTitle}>全局</span>
            {grouped.global.length === 0 ? (
              <div className={styles.inspectorEmpty}>暂无全局 agent</div>
            ) : (
              <ul className={styles.memoryList}>
                {grouped.global.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className={`${styles.memoryItem} ${f.exists ? "" : styles.memoryMissing}`}
                      onClick={() => void openFile(f)}
                      title={f.path}
                    >
                      <div className={styles.memoryItemHead}>
                        <strong>{f.name}</strong>
                        <em>{f.scope}</em>
                      </div>
                      <code className={styles.memoryPathLine}>{f.path}</code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {agentBase && creating && (
        <div className={styles.memoryEditor} data-popover>
          <div className={styles.memoryEditorHead}>
            <button type="button" className={styles.iconButton} onClick={() => setCreating(false)} aria-label="返回">
              <ChevronLeft size={14} />
              <span>返回</span>
            </button>
            <strong className={styles.memoryEditorTitle}>新建 agent</strong>
            <button type="button" className={styles.iconButton} onClick={() => setCreating(false)} aria-label="关闭" title="关闭">
              <X size={14} />
            </button>
          </div>
          <div className={styles.agentsCreateForm}>
            <label>
              <span>作用域</span>
              <select value={newScope} onChange={(e) => setNewScope(e.target.value as "project" | "global")}>
                {projectPath.trim() ? <option value="project">项目级（.claude/agents/）</option> : null}
                <option value="global">全局（~/.sparkloom/claude-code/agents/）</option>
              </select>
            </label>
            <label>
              <span>名称（不含 .md 后缀）</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-agent"
                autoFocus
                maxLength={80}
              />
            </label>
            <pre className={styles.agentsTemplatePreview}>{DEFAULT_AGENT_TEMPLATE}</pre>
            <div className={styles.memoryEditorActions}>
              <button type="button" className={styles.approvalDeny} onClick={() => setCreating(false)} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className={styles.approvalAllow}
                onClick={() => void doCreate()}
                disabled={saving || !newName.trim()}
              >
                {saving ? <Loader2 size={13} className={styles.spin} /> : <Plus size={13} />}
                新建
              </button>
            </div>
          </div>
        </div>
      )}

      {agentBase && selectedPath !== null && (
        <div className={styles.memoryEditor} data-popover>
          <div className={styles.memoryEditorHead}>
            <button type="button" className={styles.iconButton} onClick={closeEditor} aria-label="返回">
              <ChevronLeft size={14} />
              <span>返回</span>
            </button>
            <strong className={styles.memoryEditorTitle} title={selectedPath}>
              {selectedFile?.name || "编辑"}
            </strong>
            <button type="button" className={styles.iconButton} onClick={deleteCurrent} aria-label="删除" title="删除 agent 文件" disabled={saving}>
              <Trash2 size={14} />
            </button>
          </div>
          <code className={styles.memoryPathLine}>{selectedPath}</code>
          {loadingContent ? (
            <div className={styles.inspectorEmpty}><Loader2 size={14} className={styles.spin} /> 加载中…</div>
          ) : (
            <>
              <textarea
                className={`${styles.memoryTextarea} ${styles.agentsTextareaMono}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={DEFAULT_AGENT_TEMPLATE}
                spellCheck={false}
                rows={18}
              />
              <div className={styles.memoryEditorActions}>
                <span className={styles.memoryDirtyHint}>{dirty ? "未保存" : "已保存"}</span>
                <button type="button" className={styles.approvalDeny} onClick={closeEditor} disabled={saving}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.approvalAllow}
                  onClick={() => void saveFile()}
                  disabled={saving || !dirty}
                >
                  {saving ? <Loader2 size={13} className={styles.spin} /> : dirty ? <Save size={13} /> : <Check size={13} />}
                  保存
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
