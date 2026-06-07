import { NextRequest, NextResponse } from "next/server";
import { authenticateUser, getAvailableModels } from "../../../../../lib/proxy";

/**
 * GET /api/proxy/v1/models
 * OpenAI 兼容的模型列表接口
 * 需要 Authorization: Bearer sk-xxx
 */
export async function GET(request: NextRequest) {
  // 认证
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      { error: { message: "Missing Authorization header. Use: Bearer sk-xxx", type: "authentication_error" } },
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

  // 获取模型列表
  let modelList: string[];
  try {
    modelList = await getAvailableModels();
    if (modelList.length === 0) {
      modelList = ["deepseek-chat", "deepseek-reasoner"];
    }
  } catch (err) {
    console.warn("[Proxy/Models] 获取模型列表失败，使用默认列表:", err);
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
