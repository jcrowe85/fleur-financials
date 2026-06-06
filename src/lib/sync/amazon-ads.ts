import { gunzipSync } from "zlib";
import { subDays } from "date-fns";
import { db } from "@/lib/db";

const ADS_API_HOST = "https://advertising-api.amazon.com";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getAdsAccessToken(): Promise<string> {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMAZON_ADS_REFRESH_TOKEN!,
      client_id: process.env.AMAZON_ADS_CLIENT_ID!,
      client_secret: process.env.AMAZON_ADS_CLIENT_SECRET!,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`Amazon Ads LWA token error: ${json.error ?? res.status}`);
  }
  return json.access_token;
}

// ─── Profile discovery ────────────────────────────────────────────────────────

interface AdsProfile {
  profileId: number;
  countryCode: string;
  accountInfo?: { type?: string };
}

async function getProfileId(accessToken: string): Promise<string> {
  if (process.env.AMAZON_ADS_PROFILE_ID) return process.env.AMAZON_ADS_PROFILE_ID;

  const res = await fetch(`${ADS_API_HOST}/v2/profiles`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Amazon-Advertising-API-ClientId": process.env.AMAZON_ADS_CLIENT_ID!,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Profiles API ${res.status}: ${text.slice(0, 200)}`);
  }
  const profiles = (await res.json()) as AdsProfile[];
  const profile =
    profiles.find((p) => p.countryCode === "US" && p.accountInfo?.type === "seller") ??
    profiles.find((p) => p.countryCode === "US") ??
    profiles[0];
  if (!profile) throw new Error("No Amazon Ads profile found");
  return String(profile.profileId);
}

// ─── Report submission ────────────────────────────────────────────────────────

function adsHeaders(accessToken: string, profileId: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Amazon-Advertising-API-ClientId": process.env.AMAZON_ADS_CLIENT_ID!,
    "Amazon-Advertising-API-Scope": profileId,
  };
}

type AdProduct = "SPONSORED_PRODUCTS" | "SPONSORED_BRANDS" | "SPONSORED_DISPLAY";

const REPORT_CONFIGS: Record<
  AdProduct,
  { reportTypeId: string; columns: string[]; spendCol: string; purchasesCol: string; salesCol: string }
> = {
  SPONSORED_PRODUCTS: {
    reportTypeId: "spCampaigns",
    columns: ["date", "campaignId", "impressions", "clicks", "spend", "purchases7d", "sales7d"],
    spendCol: "spend",
    purchasesCol: "purchases7d",
    salesCol: "sales7d",
  },
  SPONSORED_BRANDS: {
    reportTypeId: "sbCampaigns",
    columns: ["date", "campaignId", "impressions", "clicks", "cost", "purchases", "sales"],
    spendCol: "cost",
    purchasesCol: "purchases",
    salesCol: "sales",
  },
  SPONSORED_DISPLAY: {
    reportTypeId: "sdCampaigns",
    columns: ["date", "campaignId", "impressions", "clicks", "cost", "purchases", "sales"],
    spendCol: "cost",
    purchasesCol: "purchases",
    salesCol: "sales",
  },
};

async function submitReport(
  accessToken: string,
  profileId: string,
  adProduct: AdProduct,
  startDate: string,
  endDate: string,
): Promise<string | null> {
  const cfg = REPORT_CONFIGS[adProduct];
  const res = await fetch(`${ADS_API_HOST}/reporting/reports`, {
    method: "POST",
    headers: {
      ...adsHeaders(accessToken, profileId),
      "Content-Type": "application/vnd.createasyncreportrequest.v3+json",
    },
    body: JSON.stringify({
      name: `${adProduct} Daily ${startDate} to ${endDate}`,
      startDate,
      endDate,
      configuration: {
        adProduct,
        groupBy: ["campaign"],
        columns: cfg.columns,
        reportTypeId: cfg.reportTypeId,
        timeUnit: "DAILY",
        format: "GZIP_JSON",
      },
    }),
  });
  const json = (await res.json()) as { reportId?: string; detail?: string; code?: string };
  if (res.status === 429) return null; // throttled — skip this type for now
  // 425 = duplicate request; extract the existing report ID from detail string
  if (res.status === 425 && json.detail) {
    const match = json.detail.match(/([0-9a-f-]{36})/i);
    if (match) return match[1];
  }
  if (!res.ok || !json.reportId) {
    throw new Error(`Create ${adProduct} report failed (${res.status}): ${json.detail ?? json.code ?? JSON.stringify(json)}`);
  }
  return json.reportId;
}

async function checkReport(
  accessToken: string,
  profileId: string,
  reportId: string,
): Promise<{ status: string; url?: string; failureReason?: string }> {
  const res = await fetch(`${ADS_API_HOST}/reporting/reports/${reportId}`, {
    headers: adsHeaders(accessToken, profileId),
  });
  return res.json() as Promise<{ status: string; url?: string; failureReason?: string }>;
}

// ─── Download & aggregate ─────────────────────────────────────────────────────

type DailyMetrics = Map<
  string,
  { spend: number; impressions: number; clicks: number; conversions: number; attributedRevenue: number }
>;

async function downloadAndMerge(url: string, adProduct: AdProduct, into: DailyMetrics): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Report download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const rows = JSON.parse(gunzipSync(buf).toString("utf8")) as Record<string, unknown>[];
  const cfg = REPORT_CONFIGS[adProduct];

  for (const row of rows) {
    const date = row.date as string;
    const prev = into.get(date) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, attributedRevenue: 0 };
    into.set(date, {
      spend: prev.spend + ((row[cfg.spendCol] as number) ?? 0),
      impressions: prev.impressions + ((row.impressions as number) ?? 0),
      clicks: prev.clicks + ((row.clicks as number) ?? 0),
      conversions: prev.conversions + ((row[cfg.purchasesCol] as number) ?? 0),
      attributedRevenue: prev.attributedRevenue + ((row[cfg.salesCol] as number) ?? 0),
    });
  }
}

// ─── Pending report state ─────────────────────────────────────────────────────

interface PendingMeta {
  reportIds: Partial<Record<AdProduct, string>>;
  profileId: string;
  startDate: string;
  endDate: string;
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export type AmazonAdsSyncStatus = "report_submitted" | "waiting_for_report" | "completed";

export interface AmazonAdsSyncResult {
  status: AmazonAdsSyncStatus;
  adProducts?: string[];
  reportAgeMinutes?: number;
  rowsUpserted?: number;
  profileId?: string;
  syncLogId: string;
}

export async function syncAmazonAds(daysBack = 7): Promise<AmazonAdsSyncResult> {
  // ── Phase 2: check if a pending report set is ready ───────────────────────
  const pending = await db.syncLog.findFirst({
    where: {
      source: "amazon_ads",
      status: "pending_report",
      startedAt: { gte: new Date(Date.now() - 90 * 60_000) },
    },
    orderBy: { startedAt: "desc" },
  });

  if (pending?.errorMessage) {
    let meta: PendingMeta;
    try {
      const parsed = JSON.parse(pending.errorMessage) as PendingMeta & { reportId?: string };
      // Migrate old single-report format to new multi-report format
      if (parsed.reportId && !parsed.reportIds) {
        parsed.reportIds = { SPONSORED_DISPLAY: parsed.reportId };
      }
      if (!parsed.reportIds || Object.keys(parsed.reportIds).length === 0) throw new Error("no reportIds");
      meta = parsed;
    } catch {
      await db.syncLog.update({
        where: { id: pending.id },
        data: { status: "error", finishedAt: new Date(), errorMessage: "Malformed pending meta" },
      });
      return submitNewReports(daysBack);
    }

    const accessToken = await getAdsAccessToken();
    const adProducts = Object.keys(meta.reportIds) as AdProduct[];

    // Check all reports; only proceed if all are COMPLETED
    const statuses = await Promise.all(
      adProducts.map((ap) => checkReport(accessToken, meta.profileId, meta.reportIds[ap]!)),
    );

    const allDone = statuses.every((s) => s.status === "COMPLETED");
    const anyFailed = statuses.some((s) => s.status === "FAILED");

    if (anyFailed) {
      const failures = statuses
        .map((s, i) => s.status === "FAILED" ? `${adProducts[i]}: ${s.failureReason}` : null)
        .filter(Boolean)
        .join("; ");
      await db.syncLog.update({
        where: { id: pending.id },
        data: { status: "error", finishedAt: new Date(), errorMessage: failures },
      });
      return { status: "waiting_for_report", syncLogId: pending.id };
    }

    if (!allDone) {
      const ageMs = Date.now() - pending.startedAt.getTime();
      return {
        status: "waiting_for_report",
        reportAgeMinutes: Math.round(ageMs / 60_000),
        adProducts,
        syncLogId: pending.id,
      };
    }

    // All COMPLETED — download and merge
    const byDate: DailyMetrics = new Map();
    for (let i = 0; i < adProducts.length; i++) {
      await downloadAndMerge(statuses[i].url!, adProducts[i], byDate);
    }

    let rowsUpserted = 0;
    for (const [dateStr, metrics] of byDate) {
      // Skip dates with zero spend across all types (empty reports)
      if (metrics.spend === 0 && metrics.impressions === 0) continue;

      const [y, m, d] = dateStr.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));

      await db.factAdSpendDaily.upsert({
        where: { date_channel: { date: dbDate, channel: "amazon_ads" } },
        update: {
          spend: metrics.spend,
          impressions: Math.round(metrics.impressions),
          clicks: Math.round(metrics.clicks),
          conversions: Math.round(metrics.conversions),
          attributedRevenue: metrics.attributedRevenue,
        },
        create: {
          date: dbDate,
          channel: "amazon_ads",
          spend: metrics.spend,
          impressions: Math.round(metrics.impressions),
          clicks: Math.round(metrics.clicks),
          conversions: Math.round(metrics.conversions),
          attributedRevenue: metrics.attributedRevenue,
          currency: "USD",
        },
      });
      rowsUpserted++;
    }

    await db.syncLog.update({
      where: { id: pending.id },
      data: { status: "success", finishedAt: new Date(), recordsUpserted: rowsUpserted, errorMessage: null },
    });

    return { status: "completed", rowsUpserted, adProducts, profileId: meta.profileId, syncLogId: pending.id };
  }

  return submitNewReports(daysBack);
}

async function submitNewReports(daysBack: number): Promise<AmazonAdsSyncResult> {
  const log = await db.syncLog.create({ data: { source: "amazon_ads", status: "pending_report" } });

  try {
    const accessToken = await getAdsAccessToken();
    const profileId = await getProfileId(accessToken);

    const endDate = new Date();
    const startDate = subDays(endDate, daysBack - 1);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const start = fmt(startDate);
    const end = fmt(endDate);

    const adProducts: AdProduct[] = ["SPONSORED_PRODUCTS", "SPONSORED_BRANDS", "SPONSORED_DISPLAY"];
    const reportIds: Partial<Record<AdProduct, string>> = {};

    for (const adProduct of adProducts) {
      const reportId = await submitReport(accessToken, profileId, adProduct, start, end);
      if (reportId) reportIds[adProduct] = reportId;
      // Small delay between submissions to avoid throttling
      await new Promise((r) => setTimeout(r, 1_500));
    }

    if (Object.keys(reportIds).length === 0) {
      throw new Error("All report submissions were throttled. Try again in a few minutes.");
    }

    const meta: PendingMeta = { reportIds, profileId, startDate: start, endDate: end };
    await db.syncLog.update({
      where: { id: log.id },
      data: { errorMessage: JSON.stringify(meta) },
    });

    return {
      status: "report_submitted",
      adProducts: Object.keys(reportIds),
      profileId,
      syncLogId: log.id,
    };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}
