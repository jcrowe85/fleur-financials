import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { syncAmazonAds } from "@/lib/sync/amazon-ads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reports generate in ~15 min; this route only submits or checks status — no long polling.
export const maxDuration = 30;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const daysBack = Math.min(Number(url.searchParams.get("days") ?? "7"), 60);
  try {
    const result = await syncAmazonAds(daysBack);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = handle;
export const POST = handle;
