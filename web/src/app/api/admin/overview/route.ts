import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "../../../../lib/admin-check";
import { getDb, type SqliteExec } from "../../../../lib/db";
import { getTimeRange } from "../../../../lib/time-range";
import { getBalanceOverview } from "../../../../lib/balance-sync";
import { parseRoles } from "../../../../lib/permissions";

const OVERVIEW_CACHE_TTL_MS = 30_000;
const BEIJING_OFFSET_SECONDS = 8 * 60 * 60;

type OverviewResponse = {
  cost: number;
  tokens: number;
  count: number;
  activeUsers: number;
  rangeLabel: string;
  trend: { day: string; tokens: number; cost: number }[];
  range: string;
  balanceSummary: unknown;
  channels: { channelId: string; channelName: string; channelCurrency: string; tokens: number; cost: number; count: number }[];
  models: { model: string; tokens: number; cost: number; count: number }[];
};

const overviewCache = new Map<string, { expiresAt: number; data: OverviewResponse }>();

function bucketToDateLabel(bucket: number): string {
  return new Date(bucket * 86400 * 1000).toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  const { session, error } = await requireRole("admin", "finance");
  if (error) return error;

  const range = request.nextUrl.searchParams.get("range") || "30d";
  const onlyBalance = request.nextUrl.searchParams.get("onlyBalance") === "true";
  const includeBreakdowns = request.nextUrl.searchParams.get("includeBreakdowns") === "true";
  const roles = parseRoles(session.role);

  if (onlyBalance) {
    return NextResponse.json({
      balanceSummary: roles.includes("admin") ? await getBalanceOverview() : null,
    });
  }

  const includeBalance = roles.includes("admin") && request.nextUrl.searchParams.get("includeBalance") === "true";
  const cacheKey = `${range}:${includeBreakdowns}:${includeBalance}`;
  const cached = overviewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.data);
  }

  const { sqlite } = await getDb();
  const dbAny = sqlite as unknown as SqliteExec;

  const { start, end, label } = getTimeRange(range);

  // 构造 WHERE 条件
  let where = `created_at >= ?`;
  const params: number[] = [start];
  if (end) {
    where += ` AND created_at < ?`;
    params.push(end);
  }
  let usageWhere = `ul.created_at >= ?`;
  if (end) {
    usageWhere += ` AND ul.created_at < ?`;
  }

  const stats = dbAny.exec(
    `SELECT COALESCE(SUM(total_tokens),0), COALESCE(SUM(cost),0), COUNT(*), COUNT(DISTINCT user_id)
     FROM usage_logs WHERE ${where}`,
    params
  );

  const trend = dbAny.exec(
    `SELECT CAST((created_at + ${BEIJING_OFFSET_SECONDS}) / 86400 AS INTEGER) as day_bucket,
       COALESCE(SUM(total_tokens), 0) as tokens,
       COALESCE(SUM(cost), 0) as cost
     FROM usage_logs WHERE ${where}
     GROUP BY day_bucket ORDER BY day_bucket`,
    params
  );

  const channelBreakdown = includeBreakdowns
    ? dbAny.exec(
      `SELECT ul.channel_id,
         COALESCE(c.name, ul.channel_id) as channel_name,
         COALESCE(c.currency, 'CNY') as channel_currency,
         COALESCE(SUM(ul.total_tokens), 0) as tokens,
         COALESCE(SUM(ul.cost), 0) as cost,
         COUNT(*) as count
       FROM usage_logs ul
       LEFT JOIN channels c ON ul.channel_id = c.id
       WHERE ${usageWhere}
       GROUP BY ul.channel_id
       ORDER BY cost DESC`,
      params
    )
    : [];

  const modelBreakdown = includeBreakdowns
    ? dbAny.exec(
      `SELECT model,
         COALESCE(SUM(total_tokens), 0) as tokens,
         COALESCE(SUM(cost), 0) as cost,
         COUNT(*) as count
       FROM usage_logs
       WHERE ${where}
       GROUP BY model
       ORDER BY cost DESC`,
      params
    )
    : [];

  const trendMap = new Map<string, { day: string; tokens: number; cost: number }>();
  for (const row of trend[0]?.values ?? []) {
    const dateLabel = bucketToDateLabel(Number(row[0]));
    const trendKey = range === "year" ? dateLabel.slice(0, 7) : dateLabel;
    const item = trendMap.get(trendKey) || { day: trendKey, tokens: 0, cost: 0 };
    item.tokens += Number(row[1] || 0);
    item.cost += Number(row[2] || 0);
    trendMap.set(trendKey, item);
  }

  // 余额概览（仅管理员可见）
  let balanceSummary = null;
  if (includeBalance) {
    balanceSummary = await getBalanceOverview();
  }

  const response: OverviewResponse = {
    cost: Number(Number(stats[0]?.values[0]?.[1] ?? 0).toFixed(4)),
    tokens: Number(stats[0]?.values[0]?.[0] ?? 0),
    count: Number(stats[0]?.values[0]?.[2] ?? 0),
    activeUsers: Number(stats[0]?.values[0]?.[3] ?? 0),
    rangeLabel: label,
    trend: Array.from(trendMap.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((item) => ({ ...item, cost: Number(item.cost.toFixed(4)) })),
    range,
    balanceSummary,
    channels: (channelBreakdown[0]?.values ?? []).map((r: unknown[]) => ({
      channelId: String(r[0]),
      channelName: String(r[1]),
      channelCurrency: String(r[2]),
      tokens: Number(r[3]),
      cost: Number(Number(r[4]).toFixed(4)),
      count: Number(r[5]),
    })),
    models: (modelBreakdown[0]?.values ?? []).map((r: unknown[]) => ({
      model: String(r[0]),
      tokens: Number(r[1]),
      cost: Number(Number(r[2]).toFixed(4)),
      count: Number(r[3]),
    })),
  };

  overviewCache.set(cacheKey, { expiresAt: Date.now() + OVERVIEW_CACHE_TTL_MS, data: response });
  return NextResponse.json(response);
}
