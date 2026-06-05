import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";
import { getDb, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { eq } from "drizzle-orm";
import { generateApiKey } from "../../../../lib/user-service";

// 配置命令里的地址用线上域名
const PROXY_BASE_URL = "https://ai.seapllo.com/v1";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = await getDb();
  const result = await db
    .select({ apiKey: users.apiKey, email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  if (result.length === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const key = result[0].apiKey;
  // 脱敏显示: sk-emp-gmhe-****m2
  const masked = key.slice(0, Math.min(key.indexOf("-", 7) + 1 || 12, 20)) + "****" + key.slice(-4);

  return NextResponse.json({
    apiKey: key,
    maskedKey: masked,
    configCommand: `export OPENAI_API_KEY=${key}\nexport OPENAI_BASE_URL=${PROXY_BASE_URL}`,
    proxyUrl: PROXY_BASE_URL,
  });
}

export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db } = await getDb();

  // 获取当前用户邮箱用于生成个性化 Key
  const userResult = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  const email = userResult[0]?.email || "";
  const emailPrefix = email ? email.split("@")[0] : undefined;
  const newKey = generateApiKey(emailPrefix);

  await db
    .update(users)
    .set({ apiKey: newKey, updatedAt: new Date() })
    .where(eq(users.id, session.userId));

  await saveDb();

  const masked = newKey.slice(0, Math.min(newKey.indexOf("-", 3) + 1 || 12, 20)) + "****" + newKey.slice(-4);

  return NextResponse.json({
    apiKey: newKey,
    maskedKey: masked,
    configCommand: `export OPENAI_API_KEY=${newKey}\nexport OPENAI_BASE_URL=${PROXY_BASE_URL}`,
    proxyUrl: PROXY_BASE_URL,
  });
}
