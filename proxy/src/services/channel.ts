import { loadChannels } from "./web-internal.js";

export interface ChannelInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

const CHANNEL_CACHE_TTL = 30_000; // 30 秒

interface CachedChannels {
  channels: ChannelInfo[];
  fetchedAt: number;
}

let channelCache = new Map<string, CachedChannels>();

/**
 * 获取所有启用渠道（带缓存）
 * 缓存 30 秒，过期后下次调用自动刷新
 */
async function getActiveChannels(model = ""): Promise<ChannelInfo[]> {
  const now = Date.now();
  const cached = channelCache.get(model);
  if (cached && now - cached.fetchedAt < CHANNEL_CACHE_TTL) {
    return cached.channels;
  }

  const { channels: list } = await loadChannels(model || undefined);

  channelCache.set(model, { channels: list, fetchedAt: now });
  return list;
}

/**
 * 清除渠道缓存（管理后台修改渠道后可调用）
 */
export function invalidateChannelCache(): void {
  channelCache = new Map();
}

/**
 * 根据模型名查找匹配的渠道（优先级最高、状态启用的）
 * 返回 null 表示没有可用渠道
 */
export async function findChannelForModel(
  model: string
): Promise<ChannelInfo | null> {
  const all = await getActiveChannels(model);

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
  const all = await getActiveChannels(model);

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
  const { models } = await loadChannels();
  return models;
}
