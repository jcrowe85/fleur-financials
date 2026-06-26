import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mark alerts read. Body { ids?: string[] } — omit ids to clear everything unread.
export async function POST(req: Request) {
  let ids: string[] | undefined;
  try {
    const body = (await req.json()) as { ids?: unknown };
    if (Array.isArray(body?.ids)) ids = body.ids.filter((x): x is string => typeof x === "string");
  } catch {
    // no body → mark all unread read
  }

  await db.giftEngineAlert.updateMany({
    where: ids?.length ? { id: { in: ids }, readAt: null } : { readAt: null },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
