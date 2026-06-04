import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { syncAmazonFinancials } from "@/lib/sync/amazon-financials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) return new NextResponse("Unauthorized", { status: 401 });
  const url = new URL(req.url);
  const daysBack = Math.min(Number(url.searchParams.get("days") ?? "7"), 60);
  try {
    const result = await syncAmazonFinancials(daysBack);
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
