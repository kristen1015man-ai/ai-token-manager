import { Hono } from "hono";
import { displayNameForModel, toClaudeGatewayModelId } from "../services/model-alias.js";

const models = new Hono();

models.get("/", async (c) => {
  const { getAvailableModels } = await import("../services/channel.js");

  let modelList: string[] = [];
  try {
    modelList = await getAvailableModels();
  } catch {
    modelList = [];
  }

  const data = modelList.map((model) => {
    const id = toClaudeGatewayModelId(model);
    return {
      id,
      type: "model",
      display_name: displayNameForModel(model),
      created_at: "2026-01-01T00:00:00Z",
    };
  });

  return c.json({
    data,
    has_more: false,
    first_id: data[0]?.id ?? null,
    last_id: data[data.length - 1]?.id ?? null,
  });
});

export default models;
