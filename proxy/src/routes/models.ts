import { Hono } from "hono";

const models = new Hono();

models.get("/", async (c) => {
  const { getAvailableModels } = await import("../services/channel.js");
  const { getKnownModels } = await import("../utils/pricing.js");

  // 优先从数据库渠道配置获取，兜底用价格表模型列表
  let modelList: string[];
  try {
    modelList = await getAvailableModels();
    if (modelList.length === 0) {
      modelList = await getKnownModels();
    }
  } catch {
    modelList = await getKnownModels();
  }

  const data = modelList.map((id) => ({
    id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "proxy",
  }));

  return c.json({ object: "list", data });
});

export default models;
