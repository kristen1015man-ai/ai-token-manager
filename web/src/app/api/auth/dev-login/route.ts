import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSession } from "../../../../lib/auth";
import { ensureEncrypted, searchableHash } from "../../../../lib/crypto";
import { getDb, getRawExec, saveDb, type SqliteExec } from "../../../../lib/db";
import { generateApiKey } from "../../../../lib/user-service";

type DevUser = {
  userId: string;
  feishuId: string;
  name: string;
  role: string;
};

function isLocalRequest(request: NextRequest): boolean {
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return (
    host === "localhost" ||
    host.startsWith("localhost:") ||
    host === "127.0.0.1" ||
    host.startsWith("127.0.0.1:") ||
    host === "[::1]" ||
    host.startsWith("[::1]:")
  );
}

function hasAdminRole(role: string): boolean {
  return role
    .split(",")
    .map((item) => item.trim())
    .includes("admin");
}

function safeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function rowToDevUser(row: unknown[]): DevUser | null {
  const [userId, feishuId, name, role] = row;
  if (!userId || !feishuId || !name) return null;
  return {
    userId: String(userId),
    feishuId: String(feishuId),
    name: String(name),
    role: role ? String(role) : "member",
  };
}

async function createLocalDevUser(db: SqliteExec): Promise<DevUser> {
  const now = Math.floor(Date.now() / 1000);
  const userId = `dev_${randomBytes(6).toString("hex")}`;
  const feishuId = `dev_open_${randomBytes(8).toString("hex")}`;
  const name = "Sparkloom Dev Admin";
  const role = "admin";
  const apiKey = generateApiKey("dev-admin");

  db.run(
    `INSERT INTO users
      (id, feishu_id, name, avatar, email, department, department_id, group_name, group_id,
       center_name, center_id, employee_id, api_key, api_key_hash, role, status,
       monthly_quota, created_at, updated_at)
     VALUES
      (?, ?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      userId,
      feishuId,
      name,
      "dev-admin@sparkloom.local",
      "Local Development",
      "dev_department",
      "dev-admin",
      ensureEncrypted(apiKey),
      searchableHash(apiKey),
      role,
      200,
      now,
      now,
    ]
  );
  await saveDb();

  return { userId, feishuId, name, role };
}

async function pickDevUser(): Promise<DevUser | null> {
  const { sqlite } = await getDb();
  const db = getRawExec(sqlite);
  const result = db.exec(
    `SELECT id, feishu_id, name, role
     FROM users
     WHERE status = 'active'
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 500`
  );
  const users = (result[0]?.values ?? []).map(rowToDevUser).filter(Boolean) as DevUser[];
  const activeUser = users.find((user) => hasAdminRole(user.role)) ?? users[0] ?? null;
  if (activeUser) return activeUser;

  const totalRows = db.exec("SELECT COUNT(*) FROM users");
  const totalUsers = Number(totalRows[0]?.values?.[0]?.[0] ?? 0);
  if (totalUsers === 0) {
    return createLocalDevUser(db);
  }
  return null;
}

export async function GET(request: NextRequest) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_DEV_LOGIN !== "true" ||
    !isLocalRequest(request)
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const user = await pickDevUser();
  if (!user) {
    return NextResponse.json(
      {
        error: "No active local user found",
        message: "先同步或导入用户数据，再使用本地开发登录。",
      },
      { status: 404 }
    );
  }

  await createSession({
    userId: user.userId,
    feishuId: user.feishuId,
    name: user.name,
    role: user.role,
  });

  const nextPath =
    safeNextPath(request.nextUrl.searchParams.get("next")) ??
    (hasAdminRole(user.role) ? "/studio" : "/dashboard");
  return NextResponse.redirect(new URL(nextPath, request.url));
}
