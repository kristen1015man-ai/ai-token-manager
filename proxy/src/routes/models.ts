import { Hono } from "hono";

const models = new Hono();

models.get("/", async (c) => {
  const { getAvailableModels } = await import("../services/channel.js");

  let modelList: string[];
  try {
    modelList = await getAvailableModels();
  } catch {
    modelList = [];
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
