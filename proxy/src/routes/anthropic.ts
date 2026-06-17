import { Hono, type Context } from "hono";

const anthropic = new Hono();
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

function maxBodyBytes(): number {
  const parsed = Number(process.env.MAX_CHAT_BODY_BYTES || process.env.MAX_REQUEST_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_BODY_BYTES;
}

async function readJsonBodyWithLimit(request: Request): Promise<Record<string, unknown>> {
  const maxBytes = maxBodyBytes();
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

async function parseBody(c: Context) {
  try {
    return { body: await readJsonBodyWithLimit(c.req.raw), error: null as Response | null };
  } catch (err) {
    if (err instanceof Error && err.message === "REQUEST_BODY_TOO_LARGE") {
      return {
        body: null,
        error: c.json({ type: "error", error: { type: "request_too_large", message: "Request body too large" } }, 413),
      };
    }
    return {
      body: null,
      error: c.json({ type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } }, 400),
    };
  }
}

function clientHeaders(c: Context) {
  return {
    anthropicVersion: c.req.header("anthropic-version") || undefined,
    anthropicBeta: c.req.header("anthropic-beta") || undefined,
  };
}

anthropic.post("/", async (c) => {
  const { body, error } = await parseBody(c);
  if (error) return error;

  const model = typeof body?.model === "string" ? body.model : "";
  if (!model) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "Missing required field: model" } }, 400);
  }

  const { proxyAnthropicMessagesRequest } = await import("../services/anthropic.js");
  return proxyAnthropicMessagesRequest(c.get("userId"), body as { model: string; stream?: boolean }, clientHeaders(c));
});

anthropic.post("/count_tokens", async (c) => {
  const { body, error } = await parseBody(c);
  if (error) return error;

  const model = typeof body?.model === "string" ? body.model : "";
  if (!model) {
    return c.json({ type: "error", error: { type: "invalid_request_error", message: "Missing required field: model" } }, 400);
  }

  const { proxyAnthropicCountTokensRequest } = await import("../services/anthropic.js");
  return proxyAnthropicCountTokensRequest(body as { model: string }, clientHeaders(c));
});

export default anthropic;
