import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { syncMeta } from "@/lib/sync/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Ad-level insights + activity-bounded metadata for the cron window (days=2)
// runs in ~20s, but allow headroom for traffic spikes / larger manual ranges.
export const maxDuration = 120;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "7");
  const daysBack = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 90) : 7;

  try {
    const result = await syncMeta(daysBack);
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
