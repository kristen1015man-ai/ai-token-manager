import { NextResponse } from "next/server";
import { requireActiveSession } from "../../../../lib/admin-check";
import { getDb, getRawExec } from "../../../../lib/db";
import { getStudioModels, groupStudioModels } from "../../../../lib/studio-models";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await requireActiveSession();
  if (error) return error;

  const { sqlite } = await getDb();
  const raw = getRawExec(sqlite);
  const models = getStudioModels(raw);

  return NextResponse.json({
    models,
    groups: groupStudioModels(models),
  });
}
