import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec, saveDb } from "../../../../lib/db";
import { users } from "../../../../../../shared/schema";
import { generateApiKey } from "../../../../lib/user-service";
import { deleteUserApiKey, insertUserApiKey, listUserApiKeys } from "../../../../lib/user-api-keys";

const DEFAULT_MAX_USER_API_KEYS = 5;
const DEFAULT_CREATE_COOLDOWN_SECONDS = 60;

function positiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getProxyBaseUrl(request: Request): string {
  if (process.env.PUBLIC_PROXY_BASE_URL) return process.env.PUBLIC_PROXY_BASE_URL.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const protocol = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}/v1`;
}

async function getSessionUser(sessionUserId: string) {
  const { db, sqlite } = await getDb();
  const result = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, sessionUserId))
    .limit(1);
  return { user: result[0] || null, sqlite };
}

export async function GET(request: Request) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const { user, sqlite } = await getSessionUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const raw = getRawExec(sqlite);
  const keys = listUserApiKeys(raw, user.id);

  return NextResponse.json({
    keys,
    maskedKey: keys[0]?.maskedKey || "",
    proxyUrl: getProxyBaseUrl(request),
  });
}

export async function POST(request: Request) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  const { user, sqlite } = await getSessionUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const raw = getRawExec(sqlite);
  const existingKeys = listUserApiKeys(raw, user.id);
  const maxKeys = positiveIntegerEnv("MAX_USER_API_KEYS_PER_USER", DEFAULT_MAX_USER_API_KEYS);
  if (existingKeys.length >= maxKeys) {
    return NextResponse.json(
      { error: `最多只能保留 ${maxKeys} 个员工密钥。请先删除不用的密钥再新建。` },
      { status: 400 }
    );
  }

  const cooldownSeconds = positiveIntegerEnv("USER_API_KEY_CREATE_COOLDOWN_SECONDS", DEFAULT_CREATE_COOLDOWN_SECONDS);
  const latestCreatedAt = Math.max(0, ...existingKeys.map((key) => key.createdAt || 0));
  const now = Math.floor(Date.now() / 1000);
  if (latestCreatedAt > 0 && now - latestCreatedAt < cooldownSeconds) {
    return NextResponse.json(
      { error: `新建密钥过于频繁，请 ${cooldownSeconds} 秒后再试。` },
      { status: 429 }
    );
  }

  const emailPrefix = user.email ? user.email.split("@")[0] : undefined;
  const newKey = generateApiKey(emailPrefix || user.name);
  const createdKey = insertUserApiKey(raw, user.id, newKey, "API Key");
  const keys = listUserApiKeys(raw, user.id);
  await saveDb();

  const proxyUrl = getProxyBaseUrl(request);
  return NextResponse.json({
    apiKey: newKey,
    createdKey,
    keys,
    maskedKey: createdKey.maskedKey,
    proxyUrl,
  });
}

export async function DELETE(request: Request) {
  const { session, error } = await requireActiveSession();
  if (error) return error;

  let body: { id?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const keyId = typeof body.id === "string" ? body.id.trim() : "";
  if (!keyId) {
    return NextResponse.json({ error: "Missing API key id" }, { status: 400 });
  }

  const { user, sqlite } = await getSessionUser(session.userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const raw = getRawExec(sqlite);
  try {
    const keys = deleteUserApiKey(raw, user.id, keyId);
    await saveDb();
    return NextResponse.json({
      keys,
      maskedKey: keys[0]?.maskedKey || "",
      proxyUrl: getProxyBaseUrl(request),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete API key";
    const status = message.includes("At least one") ? 400 : 404;
    return NextResponse.json({ error: message }, { status });
  }
}
