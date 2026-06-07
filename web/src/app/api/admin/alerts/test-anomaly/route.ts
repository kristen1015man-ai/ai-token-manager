import { NextRequest, NextResponse } from "next/server";
import { getDb } from "../../../../../lib/db";
import { users } from "../../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { sendCardMessage } from "../../../../../lib/feishu-bot";

/**
 * POST /api/admin/alerts/test-anomaly
 * 发送模拟异常用量告警到飞书（私聊给指定用户）
 * Body: { userName?: string }  默认 "何广明"
 *
 * 认证：INTERNAL_API_KEY Bearer token 或管理员 session
 */
export async function POST(request: NextRequest) {
  // 认证：INTERNAL_API_KEY 或管理员 session
  const authHeader = request.headers.get("Authorization") || "";
  const internalKey = process.env.INTERNAL_API_KEY;

  if (internalKey && authHeader === `Bearer ${internalKey}`) {
    // Internal API 调用 — 通过
  } else {
    // 尝试 session 认证
    const { requireAdmin } = await import("../../../../../lib/admin-check");
    const { error } = await requireAdmin();
    if (error) return error;
  }

  const body = await request.json().catch(() => ({}));
  const targetName = (body as { userName?: string }).userName || "何广明";

  // 查找目标用户的 feishu_id
  const { db } = await getDb();
  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      feishuId: users.feishuId,
      department: users.department,
    })
    .from(users)
    .where(eq(users.name, targetName))
    .limit(1);

  if (userRows.length === 0) {
    return NextResponse.json(
      { error: `未找到用户「${targetName}」，请确认用户名` },
      { status: 404 }
    );
  }

  const user = userRows[0];

  if (!user.feishuId) {
    return NextResponse.json(
      { error: `用户「${targetName}」没有绑定飞书账号（feishuId 为空）` },
      { status: 400 }
    );
  }

  // 构造模拟异常卡片
  const now = new Date();
  const hourlyCost = 88.88;
  const sevenDayAvg = 3.52;
  const multiplier = (hourlyCost / sevenDayAvg).toFixed(1);

  await sendCardMessage(user.feishuId, "open_id", {
    title: "🚨 异常用量预警（模拟测试）",
    template: "red",
    elements: [
      `🚨 **${user.name}**（${user.department || "未知部门"}）\n   近 1 小时：¥${hourlyCost.toFixed(2)}\n   7 天均值：¥${sevenDayAvg.toFixed(2)}/h（${multiplier} 倍）`,
      `⏰ 检测时间：${now.toLocaleString("zh-CN")}`,
      "💡 这是一条 **模拟测试** 消息，用于验证飞书告警通知是否正常 ✅",
    ],
  });

  return NextResponse.json({
    success: true,
    message: `已发送模拟异常告警到 ${user.name} 的飞书私聊`,
    user: { name: user.name, feishuId: user.feishuId },
  });
}
