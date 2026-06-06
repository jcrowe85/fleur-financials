import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

function businessDateStr(date: Date): string {
  return formatInTimeZone(date, BUSINESS_TZ, "yyyy-MM-dd");
}

const GRAPH_API_VERSION = "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

// ─────────────────────────────────────────────
// Graph API helpers
// ─────────────────────────────────────────────

type ActionItem = { action_type: string; value: string };

interface MetaInsightRow {
  date_start: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  outbound_clicks?: ActionItem[];
  actions?: ActionItem[];
  action_values?: ActionItem[];
  video_thruplay_watched_actions?: ActionItem[];
  video_p25_watched_actions?: ActionItem[];
  video_p50_watched_actions?: ActionItem[];
  video_p75_watched_actions?: ActionItem[];
  video_p100_watched_actions?: ActionItem[];
}

function findAction(arr: ActionItem[] | undefined, type: string): number {
  return Number(arr?.find((a) => a.action_type === type)?.value ?? 0);
}

/**
 * Run `fn` over `items` with bounded concurrency. Serial awaited upserts are
 * far too slow for the 60s cron window (hundreds of ad-level rows), so writes
 * fan out in small parallel batches against the pooled Supabase connection.
 */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

/** Sum every value in an action array (used for single-entry video arrays). */
function sumActions(arr: ActionItem[] | undefined): number {
  return arr?.reduce((s, a) => s + Number(a.value ?? 0), 0) ?? 0;
}

class MetaTokenError extends Error {}

function raiseGraphError(error: { message: string; code?: number; type?: string }): never {
  const isTokenExpired = error.code === 190 || error.type === "OAuthException";
  if (isTokenExpired) {
    throw new MetaTokenError(
      `Meta access token expired or invalid. Regenerate at: ` +
        `developers.facebook.com → Fleur-Meta app → Tools → Graph API Explorer. ` +
        `Then update META_ACCESS_TOKEN in .env.local and Vercel. (${error.message})`,
    );
  }
  throw new Error(`Meta API: ${error.message}`);
}

/** Follow `paging.next` cursors until the result set is exhausted. */
async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  const rows: T[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const res = await fetch(url);
    const json = (await res.json()) as {
      data?: T[];
      paging?: { next?: string };
      error?: { message: string; code?: number; type?: string };
    };
    if (json.error) raiseGraphError(json.error);
    if (json.data) rows.push(...json.data);
    url = json.paging?.next ?? null;
  }
  return rows;
}

const INSIGHT_FIELDS = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "inline_link_clicks",
  "outbound_clicks",
  "actions",
  "action_values",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
].join(",");

const LEVEL_ID_FIELDS: Record<MetaLevel, string> = {
  account: "",
  campaign: "campaign_id",
  adset: "adset_id,campaign_id",
  ad: "ad_id,adset_id,campaign_id",
};

type MetaLevel = "account" | "campaign" | "adset" | "ad";

function fetchInsights(level: MetaLevel, dateFrom: string, dateTo: string): Promise<MetaInsightRow[]> {
  const adAccountId = process.env.META_AD_ACCOUNT_ID!;
  const accessToken = process.env.META_ACCESS_TOKEN!;
  const idFields = LEVEL_ID_FIELDS[level];
  const fields = idFields ? `${idFields},${INSIGHT_FIELDS}` : INSIGHT_FIELDS;

  const url =
    `${GRAPH_BASE}/act_${adAccountId}/insights?` +
    new URLSearchParams({
      access_token: accessToken,
      fields,
      time_increment: "1",
      time_range: JSON.stringify({ since: dateFrom, until: dateTo }),
      level,
      limit: "500",
    });

  return fetchAllPages<MetaInsightRow>(url);
}

function entityIdFor(level: MetaLevel, row: MetaInsightRow): string {
  switch (level) {
    case "campaign":
      return row.campaign_id ?? "";
    case "adset":
      return row.adset_id ?? "";
    case "ad":
      return row.ad_id ?? "";
    default:
      return "account";
  }
}

/** Map a Graph insight row to the numeric columns of MetaInsightDaily. */
function mapInsight(row: MetaInsightRow) {
  return {
    spend: Number(row.spend) || 0,
    impressions: Math.round(Number(row.impressions) || 0),
    reach: Math.round(Number(row.reach) || 0),
    clicks: Math.round(Number(row.clicks) || 0),
    inlineLinkClicks: Math.round(Number(row.inline_link_clicks) || 0),
    outboundClicks: Math.round(sumActions(row.outbound_clicks)),
    purchases: Math.round(findAction(row.actions, "purchase")),
    purchaseValue: findAction(row.action_values, "purchase"),
    addToCart: Math.round(findAction(row.actions, "add_to_cart")),
    initiateCheckout: Math.round(findAction(row.actions, "initiate_checkout")),
    landingPageViews: Math.round(findAction(row.actions, "landing_page_view")),
    // Meta's "video_view" action == 3-second video plays (hook-rate numerator).
    videoViews3s: Math.round(findAction(row.actions, "video_view")),
    thruplays: Math.round(sumActions(row.video_thruplay_watched_actions)),
    videoP25: Math.round(sumActions(row.video_p25_watched_actions)),
    videoP50: Math.round(sumActions(row.video_p50_watched_actions)),
    videoP75: Math.round(sumActions(row.video_p75_watched_actions)),
    videoP100: Math.round(sumActions(row.video_p100_watched_actions)),
  };
}

function dbDateFromStr(dateStr: string): Date | null {
  if (!dateStr?.match(/^\d{4}-\d{2}-\d{2}$/)) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// ─────────────────────────────────────────────
// Insight sync (per level → MetaInsightDaily)
// ─────────────────────────────────────────────

async function syncInsightLevel(
  level: MetaLevel,
  dateFrom: string,
  dateTo: string,
): Promise<{ count: number; ids: string[] }> {
  const rows = await fetchInsights(level, dateFrom, dateTo);

  const mapped = rows
    .map((row) => {
      const dbDate = dbDateFromStr(row.date_start);
      const entityId = entityIdFor(level, row);
      if (!dbDate || !entityId) return null;
      return { dbDate, entityId, m: mapInsight(row) };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  await mapLimit(mapped, 15, async ({ dbDate, entityId, m }) => {
    await db.metaInsightDaily.upsert({
      where: { date_level_entityId: { date: dbDate, level, entityId } },
      update: { ...m, syncedAt: new Date() },
      create: { date: dbDate, level, entityId, ...m },
    });

    // Preserve the existing account-level ad-cost pipeline so profit math is
    // unchanged: account rows also land in RawMetaAdsDaily + FactAdSpendDaily.
    if (level === "account") {
      await db.rawMetaAdsDaily.upsert({
        where: { date: dbDate },
        update: {
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.purchases,
          revenue: m.purchaseValue,
          syncedAt: new Date(),
        },
        create: {
          date: dbDate,
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.purchases,
          revenue: m.purchaseValue,
        },
      });

      await db.factAdSpendDaily.upsert({
        where: { date_channel: { date: dbDate, channel: "meta" } },
        update: {
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.purchases,
          attributedRevenue: m.purchaseValue,
        },
        create: {
          date: dbDate,
          channel: "meta",
          spend: m.spend,
          impressions: m.impressions,
          clicks: m.clicks,
          conversions: m.purchases,
          attributedRevenue: m.purchaseValue,
        },
      });
    }
  });

  const ids = level === "account" ? [] : Array.from(new Set(mapped.map((x) => x.entityId)));
  return { count: mapped.length, ids };
}

// ─────────────────────────────────────────────
// Entity metadata sync (→ MetaEntity: status, budget, thumbnail, hierarchy)
// ─────────────────────────────────────────────

interface EntityNode {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  objective?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  campaign_id?: string;
  adset_id?: string;
  creative?: { thumbnail_url?: string };
}

/** Budgets arrive as integer minor units (cents). Convert to dollars. */
function centsToDollars(value: string | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n / 100 : null;
}

/**
 * Fetch object metadata for an explicit set of ids via Graph's batch `?ids=`
 * endpoint. We only fetch metadata for entities that actually had spend in the
 * window — this account has thousands of archived ads, so crawling every ad
 * edge is far too slow for the cron. Bounded by activity, not account size.
 */
async function fetchByIds(ids: string[], fields: string, batchSize: number): Promise<EntityNode[]> {
  const accessToken = process.env.META_ACCESS_TOKEN!;
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += batchSize) batches.push(ids.slice(i, i + batchSize));

  const out: EntityNode[] = [];
  await mapLimit(batches, 3, async (batch) => {
    const url =
      `${GRAPH_BASE}/?` +
      new URLSearchParams({ access_token: accessToken, ids: batch.join(","), fields });
    const res = await fetch(url);
    const json = (await res.json()) as Record<string, EntityNode> & {
      error?: { message: string; code?: number; type?: string };
    };
    if (json.error) raiseGraphError(json.error);
    for (const id of Object.keys(json)) {
      if (id === "error") continue;
      out.push({ ...json[id], id });
    }
  });
  return out;
}

async function syncEntities(ids: { campaigns: string[]; adsets: string[]; ads: string[] }): Promise<number> {
  // The ads `creative{thumbnail_url}` expansion trips Graph's data cap at large
  // batch sizes, so keep ad batches small; campaigns/ad sets are lighter.
  const [campaigns, adsets, ads] = await Promise.all([
    ids.campaigns.length
      ? fetchByIds(ids.campaigns, "id,name,status,effective_status,objective,daily_budget,lifetime_budget", 50)
      : Promise.resolve([] as EntityNode[]),
    ids.adsets.length
      ? fetchByIds(ids.adsets, "id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id", 50)
      : Promise.resolve([] as EntityNode[]),
    ids.ads.length
      ? fetchByIds(ids.ads, "id,name,status,effective_status,adset_id,campaign_id,creative{thumbnail_url}", 25)
      : Promise.resolve([] as EntityNode[]),
  ]);

  function toData(level: MetaLevel, node: EntityNode, parents: { campaignId?: string; adsetId?: string }) {
    return {
      level,
      name: node.name ?? node.id,
      campaignId: parents.campaignId ?? null,
      adsetId: parents.adsetId ?? null,
      status: node.status ?? null,
      effectiveStatus: node.effective_status ?? null,
      objective: node.objective ?? null,
      dailyBudget: centsToDollars(node.daily_budget),
      lifetimeBudget: centsToDollars(node.lifetime_budget),
      creativeThumbUrl: node.creative?.thumbnail_url ?? null,
      syncedAt: new Date(),
    };
  }

  const all = [
    ...campaigns.map((c) => ({ id: c.id, data: toData("campaign", c, {}) })),
    ...adsets.map((a) => ({ id: a.id, data: toData("adset", a, { campaignId: a.campaign_id }) })),
    ...ads.map((a) => ({ id: a.id, data: toData("ad", a, { campaignId: a.campaign_id, adsetId: a.adset_id }) })),
  ];

  await mapLimit(all, 15, async ({ id, data }) => {
    await db.metaEntity.upsert({ where: { id }, update: data, create: { id, ...data } });
  });

  return all.length;
}

// ─────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────

export interface MetaSyncResult {
  rowsUpserted: number;
  insightRows: number;
  entityRows: number;
  syncLogId: string;
}

export async function syncMeta(daysBack = 7): Promise<MetaSyncResult> {
  const log = await db.syncLog.create({ data: { source: "meta_ads", status: "running" } });

  try {
    const now = new Date();
    const dateFrom = businessDateStr(subDays(now, daysBack - 1));
    const dateTo = businessDateStr(now);

    // Insights, one paginated call per level. Account first so the ad-cost
    // pipeline is refreshed even if a deeper level later hiccups. Collect the
    // ids that had activity so we only fetch metadata for those entities.
    let insightRows = 0;
    const activeIds: Record<"campaign" | "adset" | "ad", string[]> = { campaign: [], adset: [], ad: [] };
    for (const level of ["account", "campaign", "adset", "ad"] as const) {
      const res = await syncInsightLevel(level, dateFrom, dateTo);
      insightRows += res.count;
      if (level !== "account") activeIds[level] = res.ids;
    }

    // Entity metadata (status / budget / thumbnail) is best-effort: a metadata
    // failure must not discard the insight data the profit math depends on.
    let entityRows = 0;
    const warnings: string[] = [];
    try {
      entityRows = await syncEntities({
        campaigns: activeIds.campaign,
        adsets: activeIds.adset,
        ads: activeIds.ad,
      });
    } catch (err) {
      if (err instanceof MetaTokenError) throw err;
      warnings.push(`entity metadata: ${err instanceof Error ? err.message : String(err)}`);
    }

    const rowsUpserted = insightRows + entityRows;
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status: warnings.length > 0 ? "partial" : "success",
        finishedAt: new Date(),
        recordsUpserted: rowsUpserted,
        errorMessage: warnings.length > 0 ? warnings.join("; ") : null,
      },
    });

    return { rowsUpserted, insightRows, entityRows, syncLogId: log.id };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}
