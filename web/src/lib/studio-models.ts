import type { SqliteExec } from "./db";

export type StudioModelGroup = "recommended" | "performance" | "economy" | "long_context";

export interface StudioModel {
  id: string;
  claudeCodeId: string;
  displayName: string;
  provider: string;
  group: StudioModelGroup;
  inputPerMillion: number | null;
  outputPerMillion: number | null;
  cachePerMillion: number | null;
  currency: string;
}

export interface StudioModelGroupResult {
  id: StudioModelGroup;
  label: string;
  models: StudioModel[];
}

const GROUP_LABELS: Record<StudioModelGroup, string> = {
  recommended: "推荐模型",
  performance: "高性能模型",
  economy: "低成本模型",
  long_context: "长上下文模型",
};

export function toClaudeGatewayModelId(model: string): string {
  const normalized = model.trim();
  if (/^(claude|anthropic)[\w.-]*/i.test(normalized)) return normalized;
  return `claude-sparkloom-${normalized}`;
}

export function fromClaudeGatewayModelId(model: string): string {
  return model.startsWith("claude-sparkloom-")
    ? model.slice("claude-sparkloom-".length)
    : model;
}

function parseModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((m): m is string => typeof m === "string");
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
  } catch {
    return [];
  }
}

function inferGroup(model: string, input: number | null, output: number | null): StudioModelGroup {
  const lower = model.toLowerCase();
  if (lower.includes("flash") || lower.includes("lite") || lower.includes("cheap")) return "economy";
  if (lower.includes("reason") || lower.includes("r1") || lower.includes("opus") || lower.includes("max")) {
    return "performance";
  }
  if (lower.includes("128k") || lower.includes("200k") || lower.includes("long") || lower.includes("context")) {
    return "long_context";
  }
  if (input !== null && output !== null && input + output <= 10) return "economy";
  return "recommended";
}

function displayNameFor(model: string, fallback?: string | null): string {
  if (fallback && fallback.trim()) return fallback.trim();
  return model
    .split(/[-_:]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getStudioModels(db: SqliteExec): StudioModel[] {
  const channelRows = db.exec(`
    SELECT id, name, provider, models
    FROM channels
    WHERE status = 'active'
    ORDER BY priority ASC, created_at ASC
  `)[0]?.values ?? [];

  const priceRows = db.exec(`
    SELECT model, channel_id, input_per_million, output_per_million, cache_per_million, display_name, currency
    FROM model_prices
    WHERE deprecated = 0
  `)[0]?.values ?? [];

  const priceByModel = new Map<string, unknown[]>();
  for (const row of priceRows) {
    const model = String(row[0] ?? "");
    const channelId = String(row[1] ?? "");
    priceByModel.set(`${channelId}:${model}`, row);
    if (!priceByModel.has(`:${model}`)) priceByModel.set(`:${model}`, row);
  }

  const models = new Map<string, StudioModel>();
  for (const channel of channelRows) {
    const channelId = String(channel[0] ?? "");
    const provider = String(channel[2] || channel[1] || "sparkloom");
    const configuredModels = parseModels(channel[3]);
    const wildcard = configuredModels.includes("*");
    const candidates = wildcard
      ? priceRows
          .filter((row) => !row[1] || String(row[1]) === channelId)
          .map((row) => String(row[0] ?? ""))
      : configuredModels;

    for (const model of candidates) {
      if (!model || model === "*") continue;
      const price = priceByModel.get(`${channelId}:${model}`) || priceByModel.get(`:${model}`) || null;
      const input = price ? Number(price[2]) : null;
      const output = price ? Number(price[3]) : null;
      const cache = price ? Number(price[4]) : null;
      if (!models.has(model)) {
        models.set(model, {
          id: model,
          claudeCodeId: toClaudeGatewayModelId(model),
          displayName: displayNameFor(model, price ? String(price[5] ?? "") : ""),
          provider,
          group: inferGroup(model, Number.isFinite(input) ? input : null, Number.isFinite(output) ? output : null),
          inputPerMillion: Number.isFinite(input) ? input : null,
          outputPerMillion: Number.isFinite(output) ? output : null,
          cachePerMillion: Number.isFinite(cache) ? cache : null,
          currency: price ? String(price[6] || "CNY") : "CNY",
        });
      }
    }
  }

  return Array.from(models.values()).sort((a, b) => {
    const groupOrder = ["recommended", "performance", "economy", "long_context"];
    return groupOrder.indexOf(a.group) - groupOrder.indexOf(b.group) || a.displayName.localeCompare(b.displayName);
  });
}

export function groupStudioModels(models: StudioModel[]): StudioModelGroupResult[] {
  return (Object.keys(GROUP_LABELS) as StudioModelGroup[])
    .map((id) => ({
      id,
      label: GROUP_LABELS[id],
      models: models.filter((model) => model.group === id),
    }))
    .filter((group) => group.models.length > 0);
}
