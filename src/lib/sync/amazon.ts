import crypto from "crypto";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

const MARKETPLACE_ID = "ATVPDKIKX0DER"; // US
const SP_API_HOST = "sellingpartnerapi-na.amazon.com";
const SP_API_REGION = "us-east-1";
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

// ─── LWA token exchange ───────────────────────────────────────────────────────

async function getLwaAccessToken(): Promise<string> {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMAZON_REFRESH_KEY!,
      client_id: process.env.AMAZON_APP_CLIENT_ID!,
      client_secret: process.env.AMAZON_APP_SECRET!,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`LWA token error: ${json.error ?? res.status}`);
  }
  return json.access_token;
}

// ─── AWS Signature V4 ─────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function signedGet(
  path: string,
  queryParams: Record<string, string>,
  accessToken: string,
): { url: string; headers: Record<string, string> } {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID!;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY!;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const dateStamp = amzDate.slice(0, 8);

  const queryString = Object.entries(queryParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const canonicalHeaders =
    `host:${SP_API_HOST}\n` +
    `x-amz-access-token:${accessToken}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-access-token;x-amz-date";
  const canonicalRequest = ["GET", path, queryString, canonicalHeaders, signedHeaders, sha256Hex("")].join("\n");

  const credentialScope = `${dateStamp}/${SP_API_REGION}/execute-api/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const k1 = hmacSha256("AWS4" + secretKey, dateStamp);
  const k2 = hmacSha256(k1, SP_API_REGION);
  const k3 = hmacSha256(k2, "execute-api");
  const k4 = hmacSha256(k3, "aws4_request");
  const signature = hmacSha256(k4, stringToSign).toString("hex");

  const authHeader =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${SP_API_HOST}${path}?${queryString}`,
    headers: {
      Authorization: authHeader,
      "x-amz-access-token": accessToken,
      "x-amz-date": amzDate,
    },
  };
}

// ─── Timezone helpers ─────────────────────────────────────────────────────────

function businessDateOf(ms: number): string {
  return formatInTimeZone(new Date(ms), BUSINESS_TZ, "yyyy-MM-dd");
}

// UTC instant = midnight of dateStr in BUSINESS_TZ
function tzMidnight(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const seed = new Date(Date.UTC(year, month - 1, day));
  let lo = seed.getTime() - 14 * 3_600_000;
  let hi = seed.getTime() + 14 * 3_600_000;
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    const midStr = formatInTimeZone(new Date(mid), BUSINESS_TZ, "yyyy-MM-dd HH:mm:ss");
    if (midStr < `${dateStr} 00:00:00`) lo = mid;
    else hi = mid;
  }
  return new Date(hi);
}

// ─── COGS — per-ASIN cost map ─────────────────────────────────────────────────
// ASINs confirmed via Orders API. Update costs here when COGS change.

const ASIN_COSTS: Record<string, number> = {
  "B0DQG7RXG3": 6.76,   // bloom serum — single
  "B0FHWM4Z64": 20.28,  // bloom serum — 3-pack
};

// ─── Sales API ────────────────────────────────────────────────────────────────

// Compute the [start, end) instant window for a business day's Sales API query.
// Returns null when the window is degenerate — i.e. it's the current business
// day but "now minus the 2-minute Amazon lag" is still before midnight, which
// happens for the first ~2 minutes after the day rolls over. Callers treat a
// null window as "no data yet" rather than firing an invalid (start > end) request.
function salesWindow(pdtDateStr: string): { startStr: string; endStr: string } | null {
  const start = tzMidnight(pdtDateStr);
  const isToday = pdtDateStr === businessDateOf(Date.now());
  // For today use now as end (live running total); for past days use next midnight.
  const end = isToday
    ? new Date(Date.now() - 2 * 60_000) // 2min lag required by Amazon
    : new Date(start.getTime() + 86_400_000);
  if (end.getTime() <= start.getTime()) return null;
  return {
    startStr: start.toISOString().replace(/\.\d+Z$/, "Z"),
    endStr: end.toISOString().replace(/\.\d+Z$/, "Z"),
  };
}

interface DaySales {
  date: string;
  grossSales: number;
  orders: number;
  units: number;
}

async function fetchDaySales(pdtDateStr: string, accessToken: string): Promise<DaySales> {
  const win = salesWindow(pdtDateStr);
  // First ~2 minutes after midnight: today's window hasn't opened yet → no sales.
  if (!win) return { date: pdtDateStr, grossSales: 0, orders: 0, units: 0 };
  const { startStr, endStr } = win;

  const { url, headers } = signedGet("/sales/v1/orderMetrics", {
    marketplaceIds: MARKETPLACE_ID,
    interval: `${startStr}--${endStr}`,
    granularity: "Total",
    buyerType: "All",
  }, accessToken);

  const res = await fetch(url, { headers });
  const text = await res.text();

  if (!res.ok) throw new Error(`Sales API ${res.status}: ${text.slice(0, 200)}`);

  const json = JSON.parse(text) as {
    payload?: { totalSales?: { amount: number }; orderCount?: number; unitCount?: number }[];
  };

  const data = json.payload?.[0];
  return {
    date: pdtDateStr,
    grossSales: data?.totalSales?.amount ?? 0,
    orders: data?.orderCount ?? 0,
    units: data?.unitCount ?? 0,
  };
}

async function fetchDayCogs(pdtDateStr: string, accessToken: string): Promise<number | null> {
  const win = salesWindow(pdtDateStr);
  if (!win) return null; // window not open yet (see fetchDaySales)
  const { startStr, endStr } = win;

  let totalCogs = 0;
  for (const [asin, cost] of Object.entries(ASIN_COSTS)) {
    const { url, headers } = signedGet("/sales/v1/orderMetrics", {
      marketplaceIds: MARKETPLACE_ID,
      interval: `${startStr}--${endStr}`,
      granularity: "Total",
      buyerType: "All",
      asin,
    }, accessToken);
    const res = await fetch(url, { headers });
    if (!res.ok) continue;
    const json = (await res.json()) as { payload?: { unitCount?: number }[] };
    const units = json.payload?.[0]?.unitCount ?? 0;
    totalCogs += units * cost;
    // Sales API: 0.5 req/s
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return totalCogs > 0 ? totalCogs : null;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export interface AmazonSyncOptions {
  daysBack?: number;
  projectEvery?: number;
  perDayTimeoutMs?: number;
  delayMs?: number;
}

export interface AmazonSyncResult {
  daysRequested: number;
  daysSucceeded: number;
  rowsUpserted: number;
  failures: { date: string; error: string }[];
  syncLogId: string;
}

export async function syncAmazon(
  optsOrDaysBack: number | AmazonSyncOptions = 7,
): Promise<AmazonSyncResult> {
  const opts: AmazonSyncOptions =
    typeof optsOrDaysBack === "number" ? { daysBack: optsOrDaysBack } : optsOrDaysBack;
  const daysBack = opts.daysBack ?? 7;

  const log = await db.syncLog.create({ data: { source: "amazon_sp", status: "running" } });

  let rowsUpserted = 0;
  let daysSucceeded = 0;
  const failures: { date: string; error: string }[] = [];

  try {
    const accessToken = await getLwaAccessToken();

    for (let i = 0; i < daysBack; i++) {
      const dateStr = businessDateOf(Date.now() - i * 86_400_000);
      const [y, m, d] = dateStr.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));

      try {
        const day = await fetchDaySales(dateStr, accessToken);
        // 2s delay built into fetchDayCogs between each ASIN call
        const cogs = await fetchDayCogs(dateStr, accessToken);

        await db.rawAmazonSalesDaily.upsert({
          where: { date_accountId: { date: dbDate, accountId: "A1YGQT1903ICNX-US" } },
          update: {
            orderedSalesAmount: day.grossSales,
            unitsOrdered: day.units,
            totalOrderItems: day.orders,
            cogs,
            syncedAt: new Date(),
          },
          create: {
            date: dbDate,
            accountId: "A1YGQT1903ICNX-US",
            marketplace: "US",
            orderedSalesAmount: day.grossSales,
            shippedSalesAmount: 0,
            unitsOrdered: day.units,
            unitsShipped: 0,
            totalOrderItems: day.orders,
            cogs,
            currency: "USD",
          },
        });

        rowsUpserted++;
        daysSucceeded++;
      } catch (err) {
        failures.push({ date: dateStr, error: err instanceof Error ? err.message : String(err) });
      }

      // gap between days (Sales API: 0.5 req/s burst 10)
      if (i < daysBack - 1) await new Promise((r) => setTimeout(r, 2_000));
    }

    await projectAmazonToFact(daysBack);

    // Intraday hourly buckets — best-effort, never fail the daily sync over it.
    try {
      await syncAmazonHourly(accessToken);
    } catch (err) {
      failures.push({
        date: "hourly",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const status = failures.length === 0 ? "success" : daysSucceeded > 0 ? "partial" : "error";
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsUpserted: rowsUpserted,
        errorMessage: failures.length > 0
          ? failures.slice(0, 5).map((f) => `${f.date}: ${f.error}`).join("; ")
          : null,
      },
    });

    return { daysRequested: daysBack, daysSucceeded, rowsUpserted, failures, syncLogId: log.id };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}

// ─── Hourly sales (intraday pace) ─────────────────────────────────────────────
// Populates FactSalesHourly so the dashboard can compare today-so-far against
// the prior day through the same time of day. Note: Amazon's hourly data lags
// (~1-2h), so the current hour can read low until it catches up.

const HOURLY_WINDOW_DAYS = 2; // today + yesterday is enough for the pace card

interface HourBucket {
  dateStr: string;
  hour: number;
  grossSales: number;
  orders: number;
  units: number;
}

async function fetchHourlyAmazon(pdtDateStr: string, accessToken: string): Promise<HourBucket[]> {
  const win = salesWindow(pdtDateStr);
  if (!win) return []; // window not open yet (see fetchDaySales)
  const { startStr, endStr } = win;

  const { url, headers } = signedGet("/sales/v1/orderMetrics", {
    marketplaceIds: MARKETPLACE_ID,
    interval: `${startStr}--${endStr}`,
    granularity: "Hour",
    granularityTimeZone: BUSINESS_TZ,
    buyerType: "All",
  }, accessToken);

  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sales API (hourly) ${res.status}: ${text.slice(0, 200)}`);

  const json = JSON.parse(text) as {
    payload?: { interval: string; totalSales?: { amount: number }; orderCount?: number; unitCount?: number }[];
  };

  const buckets: HourBucket[] = [];
  for (const p of json.payload ?? []) {
    // interval looks like "2026-06-23T00:00:00-07:00--2026-06-23T01:00:00-07:00";
    // parse the start instant and re-bucket into the business timezone.
    const startIso = p.interval?.split("--")[0];
    if (!startIso) continue;
    const dt = new Date(startIso);
    if (Number.isNaN(dt.getTime())) continue;
    buckets.push({
      dateStr: formatInTimeZone(dt, BUSINESS_TZ, "yyyy-MM-dd"),
      hour: Number(formatInTimeZone(dt, BUSINESS_TZ, "H")),
      grossSales: p.totalSales?.amount ?? 0,
      orders: p.orderCount ?? 0,
      units: p.unitCount ?? 0,
    });
  }
  return buckets;
}

export async function syncAmazonHourly(accessToken: string): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < HOURLY_WINDOW_DAYS; i++) {
    const dateStr = businessDateOf(Date.now() - i * 86_400_000);
    const buckets = await fetchHourlyAmazon(dateStr, accessToken);
    for (const b of buckets) {
      const [y, m, d] = b.dateStr.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));
      await db.factSalesHourly.upsert({
        where: {
          date_hour_channel_subChannel: {
            date: dbDate,
            hour: b.hour,
            channel: "amazon",
            subChannel: "US",
          },
        },
        // Amazon sync treats net = gross (matches the daily projection).
        update: { grossSales: b.grossSales, netSales: b.grossSales, units: b.units, orders: b.orders },
        create: {
          date: dbDate,
          hour: b.hour,
          channel: "amazon",
          subChannel: "US",
          grossSales: b.grossSales,
          netSales: b.grossSales,
          units: b.units,
          orders: b.orders,
          currency: "USD",
        },
      });
      upserted++;
    }
    // Sales API: 0.5 req/s
    if (i < HOURLY_WINDOW_DAYS - 1) await new Promise((r) => setTimeout(r, 2_000));
  }
  return upserted;
}

export async function projectAmazonToFact(daysBack: number): Promise<void> {
  const since = subDays(new Date(), daysBack);
  const rawRows = await db.rawAmazonSalesDaily.findMany({ where: { date: { gte: since } } });

  for (const r of rawRows) {
    await db.factSalesDaily.upsert({
      where: { date_channel_subChannel: { date: r.date, channel: "amazon", subChannel: r.marketplace } },
      update: { grossSales: r.orderedSalesAmount, netSales: r.orderedSalesAmount, cogs: r.cogs, units: r.unitsOrdered, orders: r.totalOrderItems, currency: r.currency },
      create: { date: r.date, channel: "amazon", subChannel: r.marketplace, grossSales: r.orderedSalesAmount, netSales: r.orderedSalesAmount, cogs: r.cogs, units: r.unitsOrdered, orders: r.totalOrderItems, currency: r.currency },
    });
  }
}
