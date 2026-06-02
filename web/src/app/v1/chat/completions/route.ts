import { NextRequest } from "next/server";
import { authenticateUser, checkQuota, checkRateLimit, proxyChatRequest } from "../../../../lib/proxy";

/**
 * POST /v1/chat/completions
 * 短路径别名，指向 /api/proxy/v1/chat/completions
 * 这是员工实际使用的入口
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return Response.json(
      { error: { message: "Missing Authorization header. Use: Bearer sk-emp-xxx", type: "authentication_error" } },
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
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

  if (!checkRateLimit(user.id)) {
    return Response.json(
      { error: { message: "请求过于频繁，每分钟最多 60 次", type: "rate_limit_exceeded" } },
      { status: 429 }
    );
  }

  const quota = await checkQuota(user.id);
  if (!quota.ok) {
    return Response.json(
      { error: { message: quota.message, type: "quota_exceeded" } },
      { status: 429 }
    );
  }

  return proxyChatRequest(user.id, {
    model,
    stream: typeof body.stream === "boolean" ? body.stream : false,
    ...body,
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
    },
  });
}
