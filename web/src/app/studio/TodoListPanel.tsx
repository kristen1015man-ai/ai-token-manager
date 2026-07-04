"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, Loader2, ListTodo } from "lucide-react";
import styles from "./studio.module.css";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

interface Props {
  todos: TodoItem[];
  defaultExpanded?: boolean;
}

// Claude Code TodoWrite 招牌 UX：顶部可折叠进度条 + checklist
export default function TodoListPanel({ todos, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const { done, total, current } = useMemo(() => {
    const safeTotal = todos.length;
    const doneCount = todos.filter((t) => t.status === "completed").length;
    const inProgress = todos.find((t) => t.status === "in_progress");
    return {
      done: doneCount,
      total: safeTotal,
      current: inProgress?.activeForm || inProgress?.content || "",
    };
  }, [todos]);

  if (total === 0) return null;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={styles.todoPanel}>
      <div
        className={styles.todoPanelHead}
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); } }}
      >
        <span className={styles.todoPanelTitle}>
          <ListTodo size={13} />
          任务进度
        </span>
        <span className={styles.todoPanelCount}>{done}/{total} 已完成</span>
        {current && <span className={styles.todoPanelCurrent}>进行中：{current}</span>}
        <span className={styles.todoPanelChev}>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
      </div>
      <div className={styles.todoPanelBar}>
        <div className={styles.todoPanelBarFill} style={{ width: `${pct}%` }} />
      </div>
      {expanded && (
        <ul className={styles.todoPanelList}>
          {todos.length === 0 ? (
            <li className={styles.todoEmpty}>暂无任务</li>
          ) : todos.map((t, i) => (
            <li key={i} className={`${styles.todoItem} ${styles[t.status]}`}>
              {t.status === "completed" ? (
                <CheckCircle2 size={14} className={styles.todoCheck} />
              ) : t.status === "in_progress" ? (
                <Loader2 size={14} className={`${styles.todoSpinner} ${styles.spin}`} />
              ) : (
                <Circle size={14} className={styles.todoCheck} />
              )}
              <span className={styles.todoItemText}>{t.activeForm || t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
