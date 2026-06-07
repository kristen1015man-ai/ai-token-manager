import { getDb } from "../../../shared/db.js";
import { channels } from "../../../shared/schema.js";
import { eq } from "drizzle-orm";

export interface ChannelInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

// ========== 渠道缓存（30s TTL） ==========
// DB-03: 避免每次请求都查库，复用 web 端已有的 TTL 缓存模式
const CHANNEL_CACHE_TTL = 30_000; // 30 秒

interface CachedChannels {
  channels: ChannelInfo[];
  fetchedAt: number;
}

let channelCache: CachedChannels | null = null;

/**
 * 获取所有启用渠道（带缓存）
 * 缓存 30 秒，过期后下次调用自动刷新
 */
async function getActiveChannels(): Promise<ChannelInfo[]> {
  const now = Date.now();
  if (channelCache && now - channelCache.fetchedAt < CHANNEL_CACHE_TTL) {
    return channelCache.channels;
  }

  const { db } = await getDb();
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.status, "active"))
    .orderBy(channels.priority);

  const list: ChannelInfo[] = result.map((ch) => ({
    id: ch.id,
    name: ch.name,
    baseUrl: ch.baseUrl,
    apiKey: ch.apiKey,
    models: typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models,
    priority: ch.priority,
  }));

  channelCache = { channels: list, fetchedAt: now };
  return list;
}

/**
 * 清除渠道缓存（管理后台修改渠道后可调用）
 */
export function invalidateChannelCache(): void {
  channelCache = null;
}

/**
 * 根据模型名查找匹配的渠道（优先级最高、状态启用的）
 * 返回 null 表示没有可用渠道
 */
export async function findChannelForModel(
  model: string
): Promise<ChannelInfo | null> {
  const all = await getActiveChannels();

  for (const ch of all) {
    if (ch.models.includes(model) || ch.models.includes("*")) {
      return ch;
    }
  }

  return null;
}

/**
 * 查找某个渠道之后的备用渠道（同一模型、更低优先级）
 */
export async function findFallbackChannel(
  model: string,
  excludeChannelId: string
): Promise<ChannelInfo | null> {
  const all = await getActiveChannels();

  let foundExcluded = false;
  for (const ch of all) {
    if (ch.id === excludeChannelId) {
      foundExcluded = true;
      continue;
    }
    if (!foundExcluded) continue; // 跳过比已失败渠道优先级更高的

    if (ch.models.includes(model) || ch.models.includes("*")) {
      return ch;
    }
  }

  return null;
}

/**
 * 获取所有可用模型的列表（从所有启用渠道聚合）
 */
export async function getAvailableModels(): Promise<string[]> {
  const all = await getActiveChannels();

  const modelSet = new Set<string>();
  for (const ch of all) {
    for (const m of ch.models) {
      if (m !== "*") modelSet.add(m);
    }
  }

  return Array.from(modelSet);
}
