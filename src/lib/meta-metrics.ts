import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

// Mirrors the conventions in src/lib/metrics.ts: PG `date` columns round-trip
// through Prisma as JS Dates at UTC midnight, and we bound everything on the
// *business* calendar day (Pacific, matching the other syncs).
const TZ = "UTC";
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

function formatDate(date: Date): string {
  return formatInTimeZone(date, TZ, "yyyy-MM-dd");
}

function businessToday(): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {});
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function dayLabel(date: Date): string {
  return formatInTimeZone(date, TZ, "MMM d");
}

function monthLabel(date: Date): string {
  return formatInTimeZone(date, TZ, "MMM");
}

export function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

// Performance targets — drive the flagged-insight rules. Override via env.
const ROAS_TARGET = Number(process.env.META_ROAS_TARGET ?? "2");
const CPA_TARGET = process.env.META_CPA_TARGET ? Number(process.env.META_CPA_TARGET) : null;
const FREQ_CAP = Number(process.env.META_FREQ_CAP ?? "3");
// Ignore tiny-spend entities so the insight feed isn't noise.
const INSIGHT_MIN_SPEND = Number(process.env.META_INSIGHT_MIN_SPEND ?? "50");

export { ROAS_TARGET, CPA_TARGET, FREQ_CAP };

// ─────────────────────────────────────────────
// Raw aggregate + derived metrics
// ─────────────────────────────────────────────

export interface MetaRaw {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  inlineLinkClicks: number;
  outboundClicks: number;
  purchases: number;
  purchaseValue: number;
  addToCart: number;
  initiateCheckout: number;
  landingPageViews: number;
  videoViews3s: number;
  thruplays: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
}

export interface MetaMetrics extends MetaRaw {
  daysWithData: number;
  avgDailySpend: number;
  roas: number | null;
  cpa: number | null; // cost per purchase
  aov: number | null;
  cpm: number | null;
  cpc: number | null;
  ctr: number | null; // %
  linkCtr: number | null; // %
  cvr: number | null; // purchases / link clicks, %
  costPerAtc: number | null;
  costPerIc: number | null;
  hookRate: number | null; // 3s plays / impressions, %
  holdRate: number | null; // thruplays / impressions, %
  frequency: number | null; // impressions / reach (approx over multi-day ranges)
}

const SUM_SELECT = {
  spend: true,
  impressions: true,
  reach: true,
  clicks: true,
  inlineLinkClicks: true,
  outboundClicks: true,
  purchases: true,
  purchaseValue: true,
  addToCart: true,
  initiateCheckout: true,
  landingPageViews: true,
  videoViews3s: true,
  thruplays: true,
  videoP25: true,
  videoP50: true,
  videoP75: true,
  videoP100: true,
} as const;

type SumResult = { [K in keyof typeof SUM_SELECT]: unknown };

function rawFromSum(s: SumResult | null | undefined): MetaRaw {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    spend: n(s?.spend),
    impressions: n(s?.impressions),
    reach: n(s?.reach),
    clicks: n(s?.clicks),
    inlineLinkClicks: n(s?.inlineLinkClicks),
    outboundClicks: n(s?.outboundClicks),
    purchases: n(s?.purchases),
    purchaseValue: n(s?.purchaseValue),
    addToCart: n(s?.addToCart),
    initiateCheckout: n(s?.initiateCheckout),
    landingPageViews: n(s?.landingPageViews),
    videoViews3s: n(s?.videoViews3s),
    thruplays: n(s?.thruplays),
    videoP25: n(s?.videoP25),
    videoP50: n(s?.videoP50),
    videoP75: n(s?.videoP75),
    videoP100: n(s?.videoP100),
  };
}

function emptyRaw(): MetaRaw {
  return rawFromSum(null);
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

export function deriveMetrics(raw: MetaRaw, daysWithData: number): MetaMetrics {
  return {
    ...raw,
    daysWithData,
    avgDailySpend: daysWithData > 0 ? raw.spend / daysWithData : 0,
    roas: div(raw.purchaseValue, raw.spend),
    cpa: div(raw.spend, raw.purchases),
    aov: div(raw.purchaseValue, raw.purchases),
    cpm: raw.impressions > 0 ? (raw.spend / raw.impressions) * 1000 : null,
    cpc: div(raw.spend, raw.clicks),
    ctr: pct(raw.clicks, raw.impressions),
    linkCtr: pct(raw.inlineLinkClicks, raw.impressions),
    cvr: pct(raw.purchases, raw.inlineLinkClicks),
    costPerAtc: div(raw.spend, raw.addToCart),
    costPerIc: div(raw.spend, raw.initiateCheckout),
    hookRate: pct(raw.videoViews3s, raw.impressions),
    holdRate: pct(raw.thruplays, raw.impressions),
    frequency: div(raw.impressions, raw.reach),
  };
}

// ─────────────────────────────────────────────
// Account-level metrics for a date range
// ─────────────────────────────────────────────

export async function getAccountMetrics(from: Date, to: Date): Promise<MetaMetrics> {
  const agg = await db.metaInsightDaily.aggregate({
    where: { level: "account", date: { gte: from, lte: to } },
    _sum: SUM_SELECT,
    _count: { _all: true },
  });
  return deriveMetrics(rawFromSum(agg._sum as SumResult), agg._count._all);
}

// ─────────────────────────────────────────────
// Period resolution + quick-glance cards
// ─────────────────────────────────────────────

export type MetaPeriodKey = "today" | "yesterday" | "7d" | "14d" | "30d" | "mtd" | "lastmonth";

export const META_PERIOD_OPTIONS: { key: MetaPeriodKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "mtd", label: "Month to date" },
  { key: "lastmonth", label: "Last month" },
];

export interface ResolvedPeriod {
  key: MetaPeriodKey;
  label: string;
  rangeLabel: string;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  prevLabel: string;
}

export function resolveMetaPeriod(mp: string | undefined | null): ResolvedPeriod {
  const today = businessToday();
  const key = (META_PERIOD_OPTIONS.find((o) => o.key === mp)?.key ?? "7d") as MetaPeriodKey;
  const label = META_PERIOD_OPTIONS.find((o) => o.key === key)!.label;

  const nDay = (n: number, lbl: string): ResolvedPeriod => {
    const to = today;
    const from = addDays(to, -(n - 1));
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(n - 1));
    return {
      key,
      label: lbl,
      rangeLabel: `${dayLabel(from)} – ${dayLabel(to)}`,
      from,
      to,
      prevFrom,
      prevTo,
      prevLabel: `prior ${n} days`,
    };
  };

  switch (key) {
    case "today": {
      const y = addDays(today, -1);
      return {
        key,
        label,
        rangeLabel: dayLabel(today),
        from: today,
        to: today,
        prevFrom: y,
        prevTo: y,
        prevLabel: "yesterday",
      };
    }
    case "yesterday": {
      const y = addDays(today, -1);
      const db2 = addDays(today, -2);
      return {
        key,
        label,
        rangeLabel: dayLabel(y),
        from: y,
        to: y,
        prevFrom: db2,
        prevTo: db2,
        prevLabel: "day before",
      };
    }
    case "14d":
      return nDay(14, label);
    case "30d":
      return nDay(30, label);
    case "mtd": {
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth();
      const dayOfMonth = today.getUTCDate();
      const monthStart = new Date(Date.UTC(year, month, 1));
      const lastMonthStart = new Date(Date.UTC(year, month - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(year, month, 0));
      const prevTo = new Date(Date.UTC(year, month - 1, Math.min(dayOfMonth, lastMonthEnd.getUTCDate())));
      return {
        key,
        label,
        rangeLabel: `${dayLabel(monthStart)} – ${dayLabel(today)}`,
        from: monthStart,
        to: today,
        prevFrom: lastMonthStart,
        prevTo,
        prevLabel: `same days in ${monthLabel(lastMonthStart)}`,
      };
    }
    case "lastmonth": {
      const year = today.getUTCFullYear();
      const month = today.getUTCMonth();
      const lastMonthStart = new Date(Date.UTC(year, month - 1, 1));
      const lastMonthEnd = new Date(Date.UTC(year, month, 0));
      const monthBeforeStart = new Date(Date.UTC(year, month - 2, 1));
      const monthBeforeEnd = new Date(Date.UTC(year, month - 1, 0));
      return {
        key,
        label,
        rangeLabel: `${dayLabel(lastMonthStart)} – ${dayLabel(lastMonthEnd)}`,
        from: lastMonthStart,
        to: lastMonthEnd,
        prevFrom: monthBeforeStart,
        prevTo: monthBeforeEnd,
        prevLabel: monthLabel(monthBeforeStart),
      };
    }
    case "7d":
    default:
      return nDay(7, label);
  }
}

export interface MetaPeriodCard {
  key: MetaPeriodKey;
  label: string;
  rangeLabel: string;
  spend: number;
  revenue: number;
  roas: number | null;
  purchases: number;
  cpa: number | null;
  deltas: { spend: number | null; revenue: number | null; roas: number | null };
}

/** The at-a-glance row: Today / Yesterday / 7d / 30d / MTD with deltas. */
export async function getMetaPeriodCards(): Promise<MetaPeriodCard[]> {
  const keys: MetaPeriodKey[] = ["today", "yesterday", "7d", "30d", "mtd"];
  const periods = keys.map(resolveMetaPeriod);

  const pairs = await Promise.all(
    periods.map(async (p) => ({
      p,
      cur: await getAccountMetrics(p.from, p.to),
      prev: await getAccountMetrics(p.prevFrom, p.prevTo),
    })),
  );

  return pairs.map(({ p, cur, prev }) => ({
    key: p.key,
    label: p.label,
    rangeLabel: p.rangeLabel,
    spend: cur.spend,
    revenue: cur.purchaseValue,
    roas: cur.roas,
    purchases: cur.purchases,
    cpa: cur.cpa,
    deltas: {
      spend: pctDelta(cur.spend, prev.spend),
      revenue: pctDelta(cur.purchaseValue, prev.purchaseValue),
      roas: cur.roas !== null && prev.roas !== null ? pctDelta(cur.roas, prev.roas) : null,
    },
  }));
}

// ─────────────────────────────────────────────
// Daily trend (account level)
// ─────────────────────────────────────────────

export interface MetaTrendPoint {
  date: string;
  spend: number;
  revenue: number;
  roas: number | null;
  purchases: number;
}

export async function getMetaTrend(from: Date, to: Date): Promise<MetaTrendPoint[]> {
  const rows = await db.metaInsightDaily.findMany({
    where: { level: "account", date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => {
    const spend = Number(r.spend);
    const revenue = Number(r.purchaseValue);
    return { date: formatDate(r.date), spend, revenue, roas: spend > 0 ? revenue / spend : null, purchases: r.purchases };
  });
}

// ─────────────────────────────────────────────
// Hierarchy drill-down (Campaign → Ad Set → Ad)
// ─────────────────────────────────────────────

export interface MetaAdNode {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  thumbUrl: string | null;
  metrics: MetaMetrics;
}

export interface MetaAdsetNode {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  metrics: MetaMetrics;
  ads: MetaAdNode[];
}

export interface MetaCampaignNode {
  id: string;
  name: string;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  metrics: MetaMetrics;
  adsets: MetaAdsetNode[];
}

async function aggregateLevel(level: "campaign" | "adset" | "ad", from: Date, to: Date) {
  const rows = await db.metaInsightDaily.groupBy({
    by: ["entityId"],
    where: { level, date: { gte: from, lte: to } },
    _sum: SUM_SELECT,
    _count: { _all: true },
  });
  const map = new Map<string, MetaMetrics>();
  for (const r of rows) {
    map.set(r.entityId, deriveMetrics(rawFromSum(r._sum as SumResult), r._count._all));
  }
  return map;
}

export async function getMetaHierarchy(from: Date, to: Date): Promise<MetaCampaignNode[]> {
  const [campaignMetrics, adsetMetrics, adMetrics, entities] = await Promise.all([
    aggregateLevel("campaign", from, to),
    aggregateLevel("adset", from, to),
    aggregateLevel("ad", from, to),
    db.metaEntity.findMany(),
  ]);

  const entityById = new Map(entities.map((e) => [e.id, e]));

  // Ads grouped by their parent ad set.
  const adsByAdset = new Map<string, MetaAdNode[]>();
  for (const [adId, metrics] of adMetrics) {
    const e = entityById.get(adId);
    const adsetId = e?.adsetId ?? "__unknown_adset__";
    const node: MetaAdNode = {
      id: adId,
      name: e?.name ?? adId,
      status: e?.status ?? null,
      effectiveStatus: e?.effectiveStatus ?? null,
      thumbUrl: e?.creativeThumbUrl ?? null,
      metrics,
    };
    (adsByAdset.get(adsetId) ?? adsByAdset.set(adsetId, []).get(adsetId)!).push(node);
  }

  // Ad sets grouped by their parent campaign.
  const adsetsByCampaign = new Map<string, MetaAdsetNode[]>();
  for (const [adsetId, metrics] of adsetMetrics) {
    const e = entityById.get(adsetId);
    const campaignId = e?.campaignId ?? "__unknown_campaign__";
    const ads = (adsByAdset.get(adsetId) ?? []).sort((a, b) => b.metrics.spend - a.metrics.spend);
    const node: MetaAdsetNode = {
      id: adsetId,
      name: e?.name ?? adsetId,
      status: e?.status ?? null,
      effectiveStatus: e?.effectiveStatus ?? null,
      dailyBudget: e?.dailyBudget == null ? null : Number(e.dailyBudget),
      lifetimeBudget: e?.lifetimeBudget == null ? null : Number(e.lifetimeBudget),
      metrics,
      ads,
    };
    (adsetsByCampaign.get(campaignId) ?? adsetsByCampaign.set(campaignId, []).get(campaignId)!).push(node);
  }

  const campaigns: MetaCampaignNode[] = [];
  for (const [campaignId, metrics] of campaignMetrics) {
    const e = entityById.get(campaignId);
    const adsets = (adsetsByCampaign.get(campaignId) ?? []).sort((a, b) => b.metrics.spend - a.metrics.spend);
    campaigns.push({
      id: campaignId,
      name: e?.name ?? campaignId,
      status: e?.status ?? null,
      effectiveStatus: e?.effectiveStatus ?? null,
      objective: e?.objective ?? null,
      dailyBudget: e?.dailyBudget == null ? null : Number(e.dailyBudget),
      lifetimeBudget: e?.lifetimeBudget == null ? null : Number(e.lifetimeBudget),
      metrics,
      adsets,
    });
  }

  return campaigns.sort((a, b) => b.metrics.spend - a.metrics.spend);
}

// ─────────────────────────────────────────────
// Flagged insights (read-only recommendations)
// ─────────────────────────────────────────────

export type MetaAlertSeverity = "critical" | "warn" | "info";

export interface MetaAlert {
  severity: MetaAlertSeverity;
  scope: string; // entity name
  message: string;
}

/**
 * Rule-based flags over the campaigns in the selected range. Pure (no DB) so
 * the caller can reuse the hierarchy it already fetched. Only ACTIVE campaigns
 * above a minimum spend are evaluated, to keep the feed signal-rich.
 */
export function computeMetaInsights(campaigns: MetaCampaignNode[]): MetaAlert[] {
  const alerts: MetaAlert[] = [];

  const active = campaigns.filter(
    (c) => (c.effectiveStatus ?? c.status) === "ACTIVE" && c.metrics.spend >= INSIGHT_MIN_SPEND,
  );

  for (const c of active) {
    const m = c.metrics;

    if (m.purchases === 0 && m.spend >= INSIGHT_MIN_SPEND) {
      alerts.push({ severity: "critical", scope: c.name, message: `Spent ${money(m.spend)} with 0 purchases.` });
    } else if (m.roas !== null && m.roas < ROAS_TARGET) {
      alerts.push({
        severity: "warn",
        scope: c.name,
        message: `ROAS ${m.roas.toFixed(2)} below target ${ROAS_TARGET.toFixed(1)} (spend ${money(m.spend)}).`,
      });
    }

    if (CPA_TARGET !== null && m.cpa !== null && m.cpa > CPA_TARGET) {
      alerts.push({
        severity: "warn",
        scope: c.name,
        message: `CPA ${money(m.cpa)} above target ${money(CPA_TARGET)}.`,
      });
    }

    if (m.frequency !== null && m.frequency > FREQ_CAP) {
      alerts.push({
        severity: "info",
        scope: c.name,
        message: `Frequency ${m.frequency.toFixed(1)} over ${FREQ_CAP.toFixed(1)} — creative fatigue risk.`,
      });
    }
  }

  // Surface the worst (critical → warn → info) first.
  const rank: Record<MetaAlertSeverity, number> = { critical: 0, warn: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function money(v: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

// Whether any Meta data exists at all (used to hide the section pre-backfill).
export async function hasMetaData(): Promise<boolean> {
  const row = await db.metaInsightDaily.findFirst({ where: { level: "account" }, select: { id: true } });
  return row !== null;
}
