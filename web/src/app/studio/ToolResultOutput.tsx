"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import styles from "./studio.module.css";

// 工具执行结果输出：超 2000 字符时折叠摘要，点开虚拟滚动渲染全文
// 全文按行 split + slice 渲染（行数无上限时套 cap），避免一帧渲染太多 DOM
const FULL_RENDER_LINE_CAP = 500;

export interface ToolResultMessage {
  id: string;
  result?: string;
  resultFull?: string;
  resultTruncatedCap?: boolean;
  isError?: boolean;
}

interface Props {
  message: ToolResultMessage;
  expanded: boolean;
  onToggle: () => void;
}

export default function ToolResultOutput({ message, expanded, onToggle }: Props) {
  const summary = message.result || "";
  const full = message.resultFull || summary;
  const hasFull = Boolean(message.resultFull) && message.resultFull !== summary;
  const summaryLineCount = useMemo(() => (summary ? summary.split("\n").length : 0), [summary]);
  const fullLineCount = useMemo(() => (full ? full.split("\n").length : 0), [full]);

  const visibleLines = useMemo<ReactNode[]>(() => {
    if (!expanded || !full) return [];
    const lines = full.split("\n");
    const slice = lines.length > FULL_RENDER_LINE_CAP ? lines.slice(0, FULL_RENDER_LINE_CAP) : lines;
    return slice.map((ln, i) => <div key={i} className={styles.toolResultLine}>{ln || " "}</div>);
  }, [expanded, full]);

  // stderr/stdout 着色：error 红，success 绿
  const outputClass = `${styles.toolInput} ${message.isError ? styles.toolResultErr : styles.toolResultOk}`;

  if (!hasFull) {
    // 短输出：直接渲染
    return <pre className={outputClass}>{summary}</pre>;
  }
  return (
    <div className={styles.toolResultWrap}>
      {!expanded && <pre className={outputClass}>{summary}</pre>}
      {expanded && visibleLines.length > 0 && (
        <div className={styles.toolResultFull}>{visibleLines}</div>
      )}
      <button type="button" className={styles.toolResultToggle} onClick={onToggle}>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {expanded
          ? "收起输出"
          : `展开完整输出（共 ${fullLineCount} 行）`}
      </button>
      {expanded && fullLineCount > FULL_RENDER_LINE_CAP && (
        <div className={styles.toolResultTruncNote}>
          …（已折叠至前 {FULL_RENDER_LINE_CAP} 行，共 {fullLineCount} 行{message.resultTruncatedCap ? "，超出 50KB 上限的部分已被 Agent 截断" : ""}）
        </div>
      )}
    </div>
  );
}
