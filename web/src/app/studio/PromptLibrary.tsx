"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Edit3, Library, Plus, Search, Trash2, X } from "lucide-react";
import styles from "./studio.module.css";

// 任务 2 提示库：纯 web localStorage 持久化的常用 prompt 库
// 8 条预置 prompt + 用户自定义 CRUD
// 入口：composer 工具栏「提示库」按钮 + 斜杠命令 /prompt

const STORAGE_KEY = "sparkloom.prompts";

type PromptCategory = "coding" | "debug" | "docs" | "review";

interface PromptItem {
  id: string;
  title: string;
  category: PromptCategory;
  content: string;
  builtin?: boolean;
}

const CATEGORY_LABELS: Record<PromptCategory, string> = {
  coding: "编码",
  debug: "调试",
  docs: "文档",
  review: "评审",
};

const BUILTIN_PROMPTS: PromptItem[] = [
  {
    id: "builtin-review",
    title: "代码审查",
    category: "review",
    builtin: true,
    content: "请对当前改动做一次代码审查，重点关注 bug、回归、缺失测试和安全风险，并给出修改建议。",
  },
  {
    id: "builtin-test",
    title: "写单元测试",
    category: "coding",
    builtin: true,
    content: "请为以下代码编写单元测试，覆盖正常路径和边界情况，使用项目已有的测试框架。",
  },
  {
    id: "builtin-refactor",
    title: "重构建议",
    category: "coding",
    builtin: true,
    content: "请审查以下代码并给出重构建议，提升可读性、可维护性，但不改变外部行为。",
  },
  {
    id: "builtin-explain",
    title: "解释这段代码",
    category: "docs",
    builtin: true,
    content: "请用中文逐行解释这段代码的作用、关键逻辑和潜在问题。",
  },
  {
    id: "builtin-docstring",
    title: "生成文档注释",
    category: "docs",
    builtin: true,
    content: "请为以下代码生成标准的文档注释（函数签名、参数、返回值、异常、示例）。",
  },
  {
    id: "builtin-fixbug",
    title: "修复 bug",
    category: "debug",
    builtin: true,
    content: "请帮我定位并修复下面的 bug：描述现象、复现步骤、根因分析、最小可验证的修复改动。",
  },
  {
    id: "builtin-perf",
    title: "性能优化",
    category: "coding",
    builtin: true,
    content: "请分析以下代码的性能瓶颈，并给出优化建议（时间/空间复杂度、I/O、内存、并发）。",
  },
  {
    id: "builtin-readme",
    title: "生成 README",
    category: "docs",
    builtin: true,
    content: "请根据当前项目结构生成一份完整的 README.md：项目简介、功能、安装、使用、贡献指南。",
  },
];

function loadFromStorage(): PromptItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p === "object" && typeof p.id === "string" && typeof p.content === "string")
      .map((p) => ({
        id: String(p.id),
        title: String(p.title || "未命名").slice(0, 80),
        category: (CATEGORY_LABELS[p.category as PromptCategory] ? p.category : "coding") as PromptCategory,
        content: String(p.content).slice(0, 8000),
      }));
  } catch {
    return [];
  }
}

function saveToStorage(items: PromptItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota exceeded 等错误静默忽略 */
  }
}

function genId(): string {
  return `p_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}

export default function PromptLibrary({ open, onClose, onInsert }: Props) {
  const [custom, setCustom] = useState<PromptItem[]>([]);
  const [query, setQuery] = useState("");
  const [filterCat, setFilterCat] = useState<PromptCategory | "all">("all");
  const [editing, setEditing] = useState<PromptItem | null>(null);

  // 初次加载读 localStorage
  useEffect(() => {
    if (open) setCustom(loadFromStorage());
  }, [open]);

  // 自定义变更同步到 localStorage
  useEffect(() => {
    if (open) saveToStorage(custom);
  }, [custom, open]);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !editing) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, editing, onClose]);

  const allItems = useMemo(() => [...BUILTIN_PROMPTS, ...custom], [custom]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems.filter((p) => {
      if (filterCat !== "all" && p.category !== filterCat) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q);
    });
  }, [allItems, query, filterCat]);

  const grouped = useMemo(() => {
    const m = new Map<PromptCategory, PromptItem[]>();
    for (const p of filtered) {
      const arr = m.get(p.category) || [];
      arr.push(p);
      m.set(p.category, arr);
    }
    return m;
  }, [filtered]);

  const insert = useCallback((item: PromptItem) => {
    onInsert(item.content);
    onClose();
  }, [onInsert, onClose]);

  function startNew() {
    setEditing({ id: genId(), title: "", category: "coding", content: "" });
  }

  function saveEditing() {
    if (!editing) return;
    const title = editing.title.trim() || "未命名";
    const content = editing.content.trim();
    if (!content) {
      setEditing(null);
      return;
    }
    setCustom((current) => {
      const exists = current.some((p) => p.id === editing.id);
      const next = exists
        ? current.map((p) => (p.id === editing.id ? { ...editing, title, content } : p))
        : [...current, { ...editing, title, content }];
      return next;
    });
    setEditing(null);
  }

  function deleteCustom(id: string) {
    setCustom((current) => current.filter((p) => p.id !== id));
  }

  if (!open) return null;

  return (
    <div className={styles.commandOverlay} onClick={() => !editing && onClose()}>
      <div className={styles.promptLibraryDialog} onClick={(e) => e.stopPropagation()} data-popover>
        <div className={styles.skillsHeader}>
          <h3 className={styles.panelTitle}>
            <Library size={17} />
            <span>提示库</span>
          </h3>
          <button type="button" className={styles.iconButton} onClick={onClose} aria-label="关闭" title="关闭">
            <X size={16} />
          </button>
        </div>

        {editing ? (
          <div className={styles.promptEditForm}>
            <label>
              <span>标题</span>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                placeholder="例如：生成 API 文档"
                maxLength={80}
                autoFocus
              />
            </label>
            <label>
              <span>分类</span>
              <select
                value={editing.category}
                onChange={(e) => setEditing({ ...editing, category: e.target.value as PromptCategory })}
              >
                {(Object.keys(CATEGORY_LABELS) as PromptCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>内容（支持 Markdown）</span>
              <textarea
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder="输入要插入到输入框的 prompt 模板..."
                rows={8}
                maxLength={8000}
              />
            </label>
            <div className={styles.memoryEditorActions}>
              <button type="button" className={styles.approvalDeny} onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className={styles.approvalAllow} onClick={saveEditing}>
                <Check size={13} /> 保存
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.promptLibraryToolbar}>
              <label className={styles.searchBox}>
                <Search size={14} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索提示..."
                  aria-label="搜索提示"
                />
              </label>
              <div className={styles.promptCategoryFilter} role="radiogroup" aria-label="分类筛选">
                <button
                  type="button"
                  aria-checked={filterCat === "all"}
                  className={filterCat === "all" ? styles.modeActive : ""}
                  onClick={() => setFilterCat("all")}
                >
                  全部
                </button>
                {(Object.keys(CATEGORY_LABELS) as PromptCategory[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-checked={filterCat === c}
                    className={filterCat === c ? styles.modeActive : ""}
                    onClick={() => setFilterCat(c)}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
              <button type="button" className={styles.approvalAllow} onClick={startNew} title="新建自定义 prompt">
                <Plus size={13} /> 新建
              </button>
            </div>

            <div className={styles.promptLibraryBody}>
              {filtered.length === 0 ? (
                <div className={styles.inspectorEmpty}>没有匹配的提示</div>
              ) : (
                (Object.keys(CATEGORY_LABELS) as PromptCategory[]).map((cat) => {
                  const list = grouped.get(cat) || [];
                  if (list.length === 0) return null;
                  return (
                    <div key={cat} className={styles.memoryGroup}>
                      <span className={styles.memoryGroupTitle}>{CATEGORY_LABELS[cat]}</span>
                      <ul className={styles.promptList}>
                        {list.map((p) => (
                          <li key={p.id} className={styles.promptItem}>
                            <div className={styles.promptItemHead}>
                              <strong>{p.title}</strong>
                              {p.builtin && <em className={styles.promptBuiltinTag}>内置</em>}
                            </div>
                            <p className={styles.promptItemPreview}>{p.content}</p>
                            <div className={styles.promptItemActions}>
                              <button type="button" className={styles.approvalAllow} onClick={() => insert(p)}>
                                插入到输入框
                              </button>
                              {!p.builtin && (
                                <>
                                  <button
                                    type="button"
                                    className={styles.iconButton}
                                    title="编辑"
                                    onClick={() => setEditing({ ...p })}
                                  >
                                    <Edit3 size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    className={styles.iconButton}
                                    title="删除"
                                    onClick={() => deleteCustom(p.id)}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
