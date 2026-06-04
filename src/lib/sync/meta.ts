import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

function businessDateStr(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TZ, "yyyy-MM-dd");
}

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

interface MetaInsightRow {
  spend: string;
  impressions: string;
  clicks: string;
  actions?: { action_type: string; value: string }[];
  action_values?: { action_type: string; value: string }[];
  date_start: string;
}

function findAction(
  arr: { action_type: string; value: string }[] | undefined,
  type: string,
): number {
  return Number(arr?.find((a) => a.action_type === type)?.value ?? 0);
}

async function fetchInsights(dateFrom: string, dateTo: string): Promise<MetaInsightRow[]> {
  const adAccountId = process.env.META_AD_ACCOUNT_ID!;
  const accessToken = process.env.META_ACCESS_TOKEN!;

  const rows: MetaInsightRow[] = [];
  let url: string | null =
    `${GRAPH_BASE}/act_${adAccountId}/insights?` +
    new URLSearchParams({
      access_token: accessToken,
      fields: "spend,impressions,clicks,actions,action_values",
      time_increment: "1",
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      level: "account",
      limit: "90",
    });

  while (url) {
    const res = await fetch(url);
    const json = await res.json() as {
      data?: MetaInsightRow[];
      paging?: { next?: string };
      error?: { message: string; code?: number; type?: string };
    };
    if (json.error) {
      const isTokenExpired =
        json.error.code === 190 ||
        json.error.type === "OAuthException";
      if (isTokenExpired) {
        throw new Error(
          `Meta access token expired or invalid. Regenerate at: ` +
          `developers.facebook.com → Fleur-Meta app → Tools → Graph API Explorer. ` +
          `Then update META_ACCESS_TOKEN in .env.local and Vercel. (${json.error.message})`,
        );
      }
      throw new Error(`Meta API: ${json.error.message}`);
    }
    if (json.data) rows.push(...json.data);
    url = json.paging?.next ?? null;
  }

  return rows;
}

export interface MetaSyncResult {
  rowsUpserted: number;
  syncLogId: string;
}

export async function syncMeta(daysBack = 7): Promise<MetaSyncResult> {
  const log = await db.syncLog.create({ data: { source: "meta_ads", status: "running" } });

  try {
    const now = new Date();
    const dateFrom = businessDateStr(subDays(now, daysBack - 1));
    const dateTo = businessDateStr(now);

    const rows = await fetchInsights(dateFrom, dateTo);

    let rowsUpserted = 0;
    for (const row of rows) {
      const dateStr = row.date_start;
      if (!dateStr?.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

      const [y, m, d] = dateStr.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));

      const spend = Number(row.spend) || 0;
      const impressions = Math.round(Number(row.impressions) || 0);
      const clicks = Math.round(Number(row.clicks) || 0);
      const conversions = Math.round(findAction(row.actions, "purchase"));
      const revenue = findAction(row.action_values, "purchase");

      await db.rawMetaAdsDaily.upsert({
        where: { date: dbDate },
        update: { spend, impressions, clicks, conversions, revenue, syncedAt: new Date() },
        create: { date: dbDate, spend, impressions, clicks, conversions, revenue },
      });

      await db.factAdSpendDaily.upsert({
        where: { date_channel: { date: dbDate, channel: "meta" } },
        update: { spend, impressions, clicks, conversions, attributedRevenue: revenue },
        create: { date: dbDate, channel: "meta", spend, impressions, clicks, conversions, attributedRevenue: revenue },
      });

      rowsUpserted++;
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "success", finishedAt: new Date(), recordsUpserted: rowsUpserted },
    });

    return { rowsUpserted, syncLogId: log.id };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}
