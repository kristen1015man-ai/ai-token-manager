import { NextRequest } from "next/server";
import { authenticateUser, checkQuota, checkRateLimit, proxyChatRequest } from "../../../../../../lib/proxy";
import { corsOptionsResponse } from "../../../../../../lib/cors";

/**
 * POST /api/proxy/v1/chat/completions
 * OpenAI 兼容的聊天补全代理接口
 * 支持 SSE 流式和非流式两种模式
 */
export async function POST(request: NextRequest) {
  // 1. API Key 认证
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json(
      { error: { message: "Missing Authorization header. Use: Bearer sk-xxx", type: "authentication_error" } },
      { status: 401 }
    );
  }

  const apiKey = authHeader.slice(7).trim();
  const user = await authenticateUser(apiKey);
  if (!user) {
    return Response.json(
      { error: { message: "无效的 API Key", type: "authentication_error" } },
      { status: 401 }
    );
  }

  // 2. 解析请求体
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    console.warn("[Proxy/ChatCompletions] 无效的 JSON 请求体");
    return Response.json(
      { error: { message: "无效的 JSON 请求体", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const model = body.model as string | undefined;
  if (!model) {
    return Response.json(
      { error: { message: "缺少必填字段: model", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  // 3. 限频检查
  if (!checkRateLimit(user.id)) {
    return Response.json(
      { error: { message: "请求过于频繁，每分钟最多 60 次", type: "rate_limit_exceeded" } },
      { status: 429 }
    );
  }

  // 4. 限额检查
  const quota = await checkQuota(user.id);
  if (!quota.ok) {
    return Response.json(
      { error: { message: quota.message, type: "quota_exceeded" } },
      { status: 429 }
    );
  }

  // 5. 代理转发
  return proxyChatRequest(user.id, {
    model,
    stream: typeof body.stream === "boolean" ? body.stream : false,
    ...body,
  });
}

/**
 * OPTIONS 预检请求支持（CORS 白名单）
 */
export async function OPTIONS(request: NextRequest) {
  return corsOptionsResponse(request);
}
