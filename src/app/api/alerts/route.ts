import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Machine-to-machine ingest is gated by a shared secret. The dashboard UI (GET +
// /read) rides the same login cookie as the rest of the app, like the other routes.
function ingestAuthorized(req: Request): boolean {
  const secret = process.env.GIFT_ALERT_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// List recent alerts + unread count for the notification bell.
export async function GET() {
  const [alerts, unreadCount] = await Promise.all([
    db.giftEngineAlert.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
    db.giftEngineAlert.count({ where: { readAt: null } }),
  ]);
  return NextResponse.json({ alerts, unreadCount });
}

// Ingest endpoint the gift-engine POSTs to whenever it fires an alert.
export async function POST(req: Request) {
  if (!ingestAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" && body.kind ? body.kind : "unknown";
  const message =
    typeof body.message === "string" && body.message
      ? body.message
      : typeof body.details === "string" && body.details
        ? body.details
        : kind;
  const at = body.at ? new Date(String(body.at)) : new Date();

  const created = await db.giftEngineAlert.create({
    data: {
      kind: kind.slice(0, 100),
      message: message.slice(0, 2000),
      meta: (body.meta ?? body) as object,
      createdAt: isNaN(at.getTime()) ? new Date() : at,
    },
  });

  return NextResponse.json({ ok: true, id: created.id });
}
