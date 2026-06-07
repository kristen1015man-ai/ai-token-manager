import { Hono } from "hono";

const chat = new Hono();

chat.post("/", async (c) => {
  const userId = c.get("userId");
  let body: Record<string, unknown>;

  try {
    body = await c.req.json();
  } catch (err) {
    console.warn("[Chat] Invalid JSON body:", err instanceof Error ? err.message : String(err));
    return c.json(
      {
        error: {
          message: "Invalid JSON body",
          type: "invalid_request_error",
        },
      },
      400
    );
  }

  const model = body.model as string | undefined;
  if (!model) {
    return c.json(
      {
        error: {
          message: "Missing required field: model",
          type: "invalid_request_error",
        },
      },
      400
    );
  }

  const { proxyChatRequest } = await import("../services/proxy.js");
  return proxyChatRequest(userId, {
    model,
    stream: typeof body.stream === "boolean" ? body.stream : false,
    ...body,
  });
});

export default chat;
