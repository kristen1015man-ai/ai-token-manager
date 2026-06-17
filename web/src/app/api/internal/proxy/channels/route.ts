import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { channels, modelPrices } from "../../../../../../../shared/schema";
import { getDb } from "../../../../../lib/db";
import { ensureDecrypted } from "../../../../../lib/crypto";
import { requireInternalRequest } from "../../../../../lib/internal-auth";

export const dynamic = "force-dynamic";

function parseModels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((m): m is string => typeof m === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function GET(request: NextRequest) {
  const authError = requireInternalRequest(request);
  if (authError) return authError;

  const model = request.nextUrl.searchParams.get("model") || "";
  const { db } = await getDb();

  const activeChannels = await db
    .select()
    .from(channels)
    .where(eq(channels.status, "active"))
    .orderBy(channels.priority);

  const priceRows = await db
    .select({ channelId: modelPrices.channelId, model: modelPrices.model })
    .from(modelPrices);
  const pricedKeys = new Set(priceRows.map((p) => `${p.channelId ?? ""}:${p.model}`));
  const hasPrice = (channelId: string, modelName: string) =>
    pricedKeys.has(`${channelId}:${modelName}`) || pricedKeys.has(`:${modelName}`);

  const mapped = activeChannels
    .map((ch) => ({
      id: ch.id,
      name: ch.name,
      baseUrl: ch.baseUrl,
      apiKey: ensureDecrypted(ch.apiKey),
      models: parseModels(ch.models),
      priority: ch.priority,
    }))
    .filter((ch) => {
      if (!model) return true;
      const modelMatches = ch.models.includes(model) || ch.models.includes("*");
      return modelMatches && hasPrice(ch.id, model);
    });

  const wildcardChannelIds = new Set(
    activeChannels
      .filter((ch) => parseModels(ch.models).includes("*"))
      .map((ch) => ch.id)
  );
  const explicitModels = activeChannels.flatMap((ch) =>
    parseModels(ch.models)
      .filter((m) => m !== "*")
      .filter((m) => hasPrice(ch.id, m))
  );
  const wildcardModels = priceRows
    .filter((p) => !p.channelId || wildcardChannelIds.has(p.channelId))
    .map((p) => p.model);
  const models = Array.from(new Set([...explicitModels, ...wildcardModels]));

  return NextResponse.json({ channels: mapped, models });
}
