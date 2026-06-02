import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, getAvailableModels } from "../../../../../lib/proxy";

/**
 * GET /v1/models
 * 短路径别名，指向 /api/proxy/v1/models
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing Authorization header. Use: Bearer sk-emp-xxx", type: "authentication_error" } },
      { status: 401 }
    );
  }

  const apiKey = authHeader.slice(7).trim();
  const user = await authenticateUser(apiKey);
  if (!user) {
    return NextResponse.json(
      { error: { message: "无效的 API Key", type: "authentication_error" } },
      { status: 401 }
    );
  }

  let modelList: string[];
  try {
    modelList = await getAvailableModels();
    if (modelList.length === 0) modelList = ["deepseek-chat", "deepseek-reasoner"];
  } catch {
    modelList = ["deepseek-chat", "deepseek-reasoner"];
  }

  const data = modelList.map((id) => ({
    id,
    object: "model" as const,
    created: Math.floor(Date.now() / 1000),
    owned_by: "proxy",
  }));

  return NextResponse.json({ object: "list", data });
}
