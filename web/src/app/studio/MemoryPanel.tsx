"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, Check, ChevronLeft, Loader2, RefreshCw, Save, X } from "lucide-react";
import styles from "./studio.module.css";

// 任务 2 内存/CLAUDE.md 面板：查看+编辑项目级、用户级、全局 CLAUDE.md
// 走 agent 端 GET/POST /claude/memory-files、/claude/memory-file
// 安全：agent 端做路径越界校验，文件名必须以 CLAUDE.md 或 .md 结尾

interface MemoryFileMeta {
  path: string;
  scope: string;
  label: string;
  exists: boolean;
  size: number;
}

interface MemoryFilesResponse {
  files: MemoryFileMeta[];
  configDir: string;
  cwd: string | null;
}

interface Props {
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  projectPath: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

export default function MemoryPanel({ agentBase, agentAuthHeaders, projectPath, onError, onNotice }: Props) {
  const [files, setFiles] = useState<MemoryFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);

  const load = useCallback(async () => {
    if (!agentBase) return;
    setLoading(true);
    try {
      const url = new URL(`${agentBase}/claude/memory-files`);
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
      const data = (await res.json()) as MemoryFilesResponse;
      setFiles(Array.isArray(data.files) ? data.files : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取 CLAUDE.md 列表失败");
    } finally {
      setLoading(false);
    }
  }, [agentBase, agentAuthHeaders, projectPath, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openFile(file: MemoryFileMeta) {
    if (!agentBase) return;
    setSelectedPath(file.path);
    setDraft("");
    setOriginalContent("");
    setLoadingContent(true);
    try {
      const url = new URL(`${agentBase}/claude/memory-file`);
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
      onError(err instanceof Error ? err.message : "读取文件失败");
      setSelectedPath(null);
    } finally {
      setLoadingContent(false);
    }
  }

  async function saveFile() {
    if (!agentBase || !selectedPath) return;
    setSaving(true);
    try {
      const res = await fetch(`${agentBase}/claude/memory-file`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "memory-file",
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

  const dirty = draft !== originalContent;
  const selectedFile = files.find((f) => f.path === selectedPath);

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <BookOpen size={17} />
          <span>CLAUDE.md 记忆</span>
        </h3>
        <button
          type="button"
          className={styles.skillsInstallAll}
          onClick={() => void load()}
          disabled={loading}
          title="重新加载文件列表"
        >
          {loading ? <Loader2 size={12} className={styles.spin} /> : <RefreshCw size={12} />}
          刷新
        </button>
      </div>

      {!agentBase && (
        <div className={styles.inspectorEmpty}>本机 Agent 未连接，无法读取 CLAUDE.md。</div>
      )}

      {agentBase && selectedPath === null && (
        <>
          <p className={styles.skillsHint}>
            点击文件可查看与编辑。修改后会即时写回磁盘，重启 Claude Code 后生效。
          </p>
          {files.length === 0 ? (
            <div className={styles.inspectorEmpty}>未发现任何 CLAUDE.md。选择项目目录后会自动列出项目级文件。</div>
          ) : (
            <ul className={styles.memoryList}>
              {files.map((f) => (
                <li key={f.path}>
                  <button
                    type="button"
                    className={`${styles.memoryItem} ${f.exists ? "" : styles.memoryMissing}`}
                    onClick={() => void openFile(f)}
                    title={f.path}
                  >
                    <div className={styles.memoryItemHead}>
                      <strong>{f.label}</strong>
                      {f.exists ? (
                        <em>{formatFileSize(f.size)}</em>
                      ) : (
                        <em className={styles.memoryAbsentTag}>未创建</em>
                      )}
                    </div>
                    <code className={styles.memoryPathLine}>{f.path}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {agentBase && selectedPath !== null && (
        <div className={styles.memoryEditor} data-popover>
          <div className={styles.memoryEditorHead}>
            <button type="button" className={styles.iconButton} onClick={closeEditor} aria-label="返回">
              <ChevronLeft size={14} />
              <span>返回</span>
            </button>
            <strong className={styles.memoryEditorTitle} title={selectedPath}>
              {selectedFile?.label || "编辑"}
            </strong>
            <button
              type="button"
              className={styles.iconButton}
              onClick={closeEditor}
              aria-label="关闭"
              title="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <code className={styles.memoryPathLine}>{selectedPath}</code>
          {loadingContent ? (
            <div className={styles.inspectorEmpty}><Loader2 size={14} className={styles.spin} /> 加载中…</div>
          ) : (
            <>
              <textarea
                className={styles.memoryTextarea}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="# CLAUDE.md&#10;在这里写本项目的指令、规范、关键文件说明…"
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
