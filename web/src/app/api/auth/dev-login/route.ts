import { NextRequest, NextResponse } from "next/server";
import { getDb, saveDb } from "../../../../lib/db";
import { createSession } from "../../../../lib/auth";

/**
 * 开发环境快捷登录（GET /api/auth/dev-login）
 *
 * 以何广明（管理员）身份登录。
 * 首次调用时会自动将何广明的 role 设为 admin。
 */
export async function GET(request: NextRequest) {
  const { sqlite } = await getDb();
  const dbAny = sqlite as any;

  // 查找何广明
  const result = dbAny.exec(
    `SELECT id, name, feishu_id, role FROM users WHERE name = '何广明' LIMIT 1`
  );

  if (!result[0]?.values?.length) {
    return NextResponse.json(
      { error: "未找到用户「何广明」，请先同步飞书员工数据" },
      { status: 404 }
    );
  }

  const userId = String(result[0].values[0][0]);
  const currentRole = String(result[0].values[0][3]);

  // 如果还不是 admin，自动提升
  if (currentRole !== "admin") {
    dbAny.exec(`UPDATE users SET role = 'admin' WHERE id = ?`, [userId]);
    await saveDb();
  }

  // 创建 session
  await createSession({
    userId,
    feishuId: String(result[0].values[0][2] || userId),
    name: "何广明",
    role: "admin",
  });

  const host = request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || "http";
  return NextResponse.redirect(new URL("/dashboard", `${protocol}://${host}`));
}
