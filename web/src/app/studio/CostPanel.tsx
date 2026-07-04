"use client";

import { useMemo } from "react";
import { Trash2, DollarSign } from "lucide-react";
import styles from "./studio.module.css";

// 任务 1 成本分析面板：展示 token 用量与估算花费
// 花费是估算值，UI 必须明确标注

export interface UsageRecord {
  sessionId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  timestamp: number;
}

// 单价表：USD per 1M tokens
// 数据来源：Anthropic 官方文档（claude-api skill 内置价格表，2026-07 核验）
// cacheWrite = 1.25 × 输入价（5m TTL）；cacheRead ≈ 0.1 × 输入价
// L10：老 Opus 档位（claude-3-opus / opus-4-0 ~ opus-4-4 等）补录于 2026-07，定价 $15/$75
interface PricingTier {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  label: string;
}

const MODEL_PRICING: Record<string, PricingTier> = {
  "claude-opus-4-8":   { in: 5,  out: 25, cacheWrite: 6.25,  cacheRead: 0.5,  label: "Opus 4.8" },
  "claude-opus-4-7":   { in: 5,  out: 25, cacheWrite: 6.25,  cacheRead: 0.5,  label: "Opus 4.7" },
  "claude-opus-4-6":   { in: 5,  out: 25, cacheWrite: 6.25,  cacheRead: 0.5,  label: "Opus 4.6" },
  "claude-opus-4-5":   { in: 5,  out: 25, cacheWrite: 6.25,  cacheRead: 0.5,  label: "Opus 4.5" },
  // 老 Opus：claude-3-opus-*、claude-opus-4-0/4-1/4-2/4-3/4-4 等，定价 $15/$75
  // （cacheWrite = 1.25 × 15 = 18.75；cacheRead ≈ 0.1 × 15 = 1.5）
  "claude-opus-legacy": { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5, label: "Opus (1.x/3.x/4.0-4.4)" },
  "claude-sonnet-5":   { in: 3,  out: 15, cacheWrite: 3.75,  cacheRead: 0.3,  label: "Sonnet 5" },
  "claude-sonnet-4-6": { in: 3,  out: 15, cacheWrite: 3.75,  cacheRead: 0.3,  label: "Sonnet 4.6" },
  "claude-sonnet-4-5": { in: 3,  out: 15, cacheWrite: 3.75,  cacheRead: 0.3,  label: "Sonnet 4.5" },
  "claude-haiku-4-5":  { in: 1,  out: 5,  cacheWrite: 1.25,  cacheRead: 0.1,  label: "Haiku 4.5" },
  "claude-fable-5":    { in: 10, out: 50, cacheWrite: 12.5,  cacheRead: 1.0,  label: "Fable 5" },
};

// 模糊匹配：用户传入的 model 字符串可能是 ID、显示名或简写
export function lookupPricing(model: string): PricingTier {
  const m = String(model || "").toLowerCase().trim();
  if (MODEL_PRICING[m]) return MODEL_PRICING[m];
  if (m.includes("fable")) return MODEL_PRICING["claude-fable-5"];
  if (m.includes("opus")) {
    // L10：先识别老 Opus（claude-3-opus、opus-4-0~4-4），归到 legacy $15/$75；
    // 仅 4.5 及以上才走 $5/$25 新档位。避免历史 Opus 被低估 3 倍。
    // 命中规则：显式 claude-3-opus，或 opus-(1|2|3|4-0|4-1|4-2|4-3|4-4) 字样
    if (m.includes("claude-3-opus") || /opus-(1|2|3|4-0|4-1|4-2|4-3|4-4)(\b|-|_|$)/.test(m)) {
      return MODEL_PRICING["claude-opus-legacy"];
    }
    return MODEL_PRICING["claude-opus-4-8"];
  }
  if (m.includes("haiku")) return MODEL_PRICING["claude-haiku-4-5"];
  if (m.includes("sonnet")) return MODEL_PRICING["claude-sonnet-5"];
  // 兜底按 Sonnet 5 估算（最常见档位），UI 会标记为"估算"
  return { ...MODEL_PRICING["claude-sonnet-5"], label: `${model || "未知"} (按 Sonnet 估算)` };
}

interface ModelAgg {
  model: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  cost: number;
  // cache_read 节省金额 = cacheRead × (输入价 − cacheRead 价) / 1M
  saved: number;
}

interface Props {
  records: UsageRecord[];
  onClear: () => void;
}

function formatUsd(value: number): string {
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function CostPanel({ records, onClear }: Props) {
  const summary = useMemo(() => {
    const byModel = new Map<string, ModelAgg>();
    let totalCost = 0;
    let totalTokens = 0;
    let totalSaved = 0;
    for (const r of records) {
      const price = lookupPricing(r.model);
      const cost = (r.inputTokens * price.in + r.outputTokens * price.out + r.cacheCreation * price.cacheWrite + r.cacheRead * price.cacheRead) / 1_000_000;
      const saved = r.cacheRead * (price.in - price.cacheRead) / 1_000_000;
      totalCost += cost;
      totalSaved += saved;
      totalTokens += r.inputTokens + r.outputTokens + r.cacheCreation + r.cacheRead;
      const key = r.model || "unknown";
      const existing = byModel.get(key);
      if (existing) {
        existing.inputTokens += r.inputTokens;
        existing.outputTokens += r.outputTokens;
        existing.cacheCreation += r.cacheCreation;
        existing.cacheRead += r.cacheRead;
        existing.cost += cost;
        existing.saved += saved;
      } else {
        byModel.set(key, {
          model: key,
          label: price.label,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cacheCreation: r.cacheCreation,
          cacheRead: r.cacheRead,
          cost,
          saved,
        });
      }
    }
    const groups = Array.from(byModel.values()).sort((a, b) => b.cost - a.cost);
    return { groups, totalCost, totalTokens, totalSaved };
  }, [records]);

  const maxCost = summary.groups.reduce((m, g) => Math.max(m, g.cost), 0);

  return (
    <div className={styles.inspectorSection}>
      <div className={styles.skillsHeader}>
        <h3 className={styles.panelTitle}>
          <DollarSign size={17} />
          <span>成本估算</span>
        </h3>
        <button
          type="button"
          className={styles.skillsInstallAll}
          onClick={onClear}
          disabled={records.length === 0}
          title="清除本地累计的用量数据"
        >
          <Trash2 size={12} />
          清除统计
        </button>
      </div>

      {records.length === 0 ? (
        <div className={styles.inspectorEmpty}>
          暂无用量数据。开始一个任务后，token 用量会自动累计到这里。
        </div>
      ) : (
        <>
          <div className={styles.costSummaryRow}>
            <div className={styles.costSummaryCell}>
              <span className={styles.costSummaryLabel}>总花费估算</span>
              <strong className={styles.costSummaryValue}>{formatUsd(summary.totalCost)}</strong>
            </div>
            <div className={styles.costSummaryCell}>
              <span className={styles.costSummaryLabel}>总 tokens</span>
              <strong className={styles.costSummaryValue}>{formatTokens(summary.totalTokens)}</strong>
            </div>
            <div className={styles.costSummaryCell}>
              <span className={styles.costSummaryLabel}>缓存节省</span>
              <strong className={styles.costSummaryValueSaved}>{formatUsd(summary.totalSaved)}</strong>
            </div>
          </div>

          <p className={styles.skillsHint}>
            估算值（按模型单价计算），实际以主系统账单为准。
          </p>

          <ul className={styles.costGroupList}>
            {summary.groups.map((g) => {
              const widthPct = maxCost > 0 ? Math.max(2, (g.cost / maxCost) * 100) : 0;
              return (
                <li key={g.model} className={styles.costGroupItem}>
                  <div className={styles.costGroupHead}>
                    <strong>{g.label}</strong>
                    <em>{formatUsd(g.cost)}</em>
                  </div>
                  <div className={styles.costBarTrack}>
                    <div className={styles.costBarFill} style={{ width: `${widthPct}%` }} />
                  </div>
                  <div className={styles.costGroupMeta}>
                    <span>输入 {formatTokens(g.inputTokens)}</span>
                    <span>输出 {formatTokens(g.outputTokens)}</span>
                    <span>cache 写 {formatTokens(g.cacheCreation)}</span>
                    <span>cache 读 {formatTokens(g.cacheRead)}</span>
                    {g.saved > 0 && <span className={styles.costSavedTag}>省 {formatUsd(g.saved)}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
