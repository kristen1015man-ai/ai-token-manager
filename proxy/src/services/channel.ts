import { getDb } from "../../../shared/db.js";
import { channels } from "../../../shared/schema.js";
import { eq, and, gt } from "drizzle-orm";

export interface ChannelInfo {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  priority: number;
}

/**
 * 根据模型名查找匹配的渠道（优先级最高、状态启用的）
 * 返回 null 表示没有可用渠道
 */
export async function findChannelForModel(
  model: string
): Promise<ChannelInfo | null> {
  const { db } = await getDb();
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.status, "active"))
    .orderBy(channels.priority);

  // 遍历所有启用的渠道，找到支持该模型的
  for (const ch of result) {
    const models: string[] =
      typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models;
    if (models.includes(model) || models.includes("*")) {
      return {
        id: ch.id,
        name: ch.name,
        baseUrl: ch.baseUrl,
        apiKey: ch.apiKey,
        models,
        priority: ch.priority,
      };
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
  const { db } = await getDb();
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.status, "active"))
    .orderBy(channels.priority);

  let foundExcluded = false;
  for (const ch of result) {
    if (ch.id === excludeChannelId) {
      foundExcluded = true;
      continue;
    }
    if (!foundExcluded) continue; // 跳过比已失败渠道优先级更高的

    const models: string[] =
      typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models;
    if (models.includes(model) || models.includes("*")) {
      return {
        id: ch.id,
        name: ch.name,
        baseUrl: ch.baseUrl,
        apiKey: ch.apiKey,
        models,
        priority: ch.priority,
      };
    }
  }

  return null;
}

/**
 * 获取所有可用模型的列表（从所有启用渠道聚合）
 */
export async function getAvailableModels(): Promise<string[]> {
  const { db } = await getDb();
  const result = await db
    .select()
    .from(channels)
    .where(eq(channels.status, "active"));

  const modelSet = new Set<string>();
  for (const ch of result) {
    const models: string[] =
      typeof ch.models === "string" ? JSON.parse(ch.models) : ch.models;
    for (const m of models) {
      if (m !== "*") modelSet.add(m);
    }
  }

  return Array.from(modelSet);
}
