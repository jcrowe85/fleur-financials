import { NextResponse } from "next/server";
import {
  defaultRange,
  getSalesMetrics,
  parseDateBound,
  rangeFromDays,
} from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");

  const explicitFrom = parseDateBound(url.searchParams.get("from"));
  const explicitTo = parseDateBound(url.searchParams.get("to"));
  const daysParam = url.searchParams.get("days");

  let from: Date;
  let to: Date;
  if (explicitFrom && explicitTo) {
    from = explicitFrom;
    to = explicitTo;
  } else if (daysParam) {
    ({ from, to } = rangeFromDays(Number(daysParam)));
  } else {
    ({ from, to } = defaultRange());
  }

  const metrics = await getSalesMetrics({ from, to, channel });
  return NextResponse.json(metrics);
}
