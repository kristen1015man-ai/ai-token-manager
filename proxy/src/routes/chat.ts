import { Hono } from "hono";

const chat = new Hono();
const DEFAULT_MAX_CHAT_BODY_BYTES = 2 * 1024 * 1024;

function maxChatBodyBytes(): number {
  const parsed = Number(process.env.MAX_CHAT_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_CHAT_BODY_BYTES;
}

async function readJsonBodyWithLimit(request: Request): Promise<Record<string, unknown>> {
  const maxBytes = maxChatBodyBytes();
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("REQUEST_BODY_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) return {};

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
}

chat.post("/", async (c) => {
  const userId = c.get("userId");
  let body: Record<string, unknown>;

  try {
    body = await readJsonBodyWithLimit(c.req.raw);
  } catch (err) {
    if (err instanceof Error && err.message === "REQUEST_BODY_TOO_LARGE") {
      return c.json(
        {
          error: {
            message: "Request body too large",
            type: "request_too_large",
          },
        },
        413
      );
    }
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
