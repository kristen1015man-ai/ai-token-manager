"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, FileText, LayoutTemplate, Loader2, RefreshCw } from "lucide-react";
import styles from "./studio.module.css";

// 任务 1 模板画廊：调用 agent /claude/templates 拉模板列表，POST /claude/init-template 在 cwd 下生成
// 已存在文件不覆盖（agent 端返回 skipped 列表），UI 显示 created/skipped 反馈

interface TemplateMeta {
  id: string;
  name: string;
  desc: string;
  icon: string;
  fileCount: number;
}

interface InitResult {
  ok: boolean;
  templateId: string;
  cwd: string;
  created: string[];
  skipped: Array<{ path: string; reason: string }>;
}

interface Props {
  agentBase: string | null;
  agentAuthHeaders: (extra?: Record<string, string>) => Record<string, string>;
  projectPath: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onConfirm: (message: string, onConfirm: () => void) => void;
}

export default function TemplatesPanel({ agentBase, agentAuthHeaders, projectPath, onError, onNotice, onConfirm }: Props) {
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agentBase) return;
    setLoading(true);
    try {
      const res = await fetch(`${agentBase}/claude/templates`, {
        method: "GET",
        headers: agentAuthHeaders(),
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { templates: TemplateMeta[] };
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "读取模板列表失败");
    } finally {
      setLoading(false);
    }
  }, [agentBase, agentAuthHeaders, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyTemplate(t: TemplateMeta) {
    if (!agentBase) {
      onError("本机 Agent 未连接");
      return;
    }
    if (!projectPath.trim()) {
      onError("请先在 Inspector「执行」标签选择项目目录");
      return;
    }
    onConfirm(
      `将模板「${t.name}」生成到 ${projectPath.trim()}（共 ${t.fileCount} 个文件）。已存在的文件不会被覆盖。`,
      () => void doApply(t),
    );
  }

  async function doApply(t: TemplateMeta) {
    if (!agentBase || applying) return;
    setApplying(t.id);
    try {
      const res = await fetch(`${agentBase}/claude/init-template`, {
        method: "POST",
        headers: agentAuthHeaders({
          "Content-Type": "application/json",
          "x-sparkloom-local-confirm": "init-template",
        }),
        body: JSON.stringify({ templateId: t.id, cwd: projectPath.trim() }),
      });
      const body = await res.json().catch(() => ({} as Partial<InitResult & { error?: string }>));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const created = Array.isArray(body.created) ? body.created.length : 0;
      const skipped = Array.isArray(body.skipped) ? body.skipped.length : 0;
      if (created === 0 && skipped > 0) {
        onNotice(`所有 ${skipped} 个文件已存在，未生成新文件`);
      } else {
        onNotice(`已生成 ${created} 个文件${skipped > 0 ? `（跳过 ${skipped} 个已存在）` : ""}`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : "应用模板失败");
    } finally {
      setApplying(null);
    }
  }

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <LayoutTemplate size={17} />
          <span>项目模板</span>
        </h3>
        <button
          type="button"
          className={styles.skillsInstallAll}
          onClick={() => void load()}
          disabled={loading}
          title="重新加载模板列表"
        >
          {loading ? <Loader2 size={12} className={styles.spin} /> : <RefreshCw size={12} />}
          刷新
        </button>
      </div>

      {!agentBase && (
        <div className={styles.inspectorEmpty}>本机 Agent 未连接，无法读取模板。</div>
      )}

      {agentBase && !projectPath.trim() && (
        <p className={styles.skillsHint}>
          <ChevronLeft size={12} /> 请先在 Inspector「执行」标签选择项目目录，模板会生成到该目录。
        </p>
      )}

      {agentBase && projectPath.trim() && (
        <>
          <p className={styles.skillsHint}>
            选择一个模板一键生成到当前项目目录。已存在的文件不会被覆盖。
          </p>
          {templates.length === 0 ? (
            <div className={styles.inspectorEmpty}>{loading ? "加载中…" : "无可用模板"}</div>
          ) : (
            <div className={styles.templateGrid}>
              {templates.map((t) => (
                <div key={t.id} className={styles.templateCard}>
                  <div className={styles.templateCardHead}>
                    <span className={styles.templateIcon} aria-hidden>{t.icon}</span>
                    <strong>{t.name}</strong>
                  </div>
                  <p className={styles.templateDesc}>{t.desc}</p>
                  <div className={styles.templateCardFoot}>
                    <em><FileText size={11} /> {t.fileCount} 文件</em>
                    <button
                      type="button"
                      className={styles.approvalAllow}
                      onClick={() => applyTemplate(t)}
                      disabled={applying !== null}
                    >
                      {applying === t.id ? <Loader2 size={12} className={styles.spin} /> : "使用此模板"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
