import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth";
import { syncShopify } from "@/lib/sync/shopify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  if (!isCronAuthorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get("days") ?? "7");
  const daysBack =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 7;
  const projectParam = Number(url.searchParams.get("projectEvery") ?? "7");
  const projectEvery =
    Number.isFinite(projectParam) && projectParam > 0 ? projectParam : 7;
  const timeoutParam = Number(url.searchParams.get("timeoutMs") ?? "30000");
  const perDayTimeoutMs =
    Number.isFinite(timeoutParam) && timeoutParam > 0 ? timeoutParam : 30_000;

  try {
    const result = await syncShopify({ daysBack, projectEvery, perDayTimeoutMs });
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
