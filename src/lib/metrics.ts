import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

// Date columns are PG `date`, which Prisma surfaces as JS Date at UTC midnight.
// We display and bound everything in the *business* timezone — Amazon's
// sales_and_traffic_report uses Pacific Time as its day boundary, so PT is
// the natural choice. Override with BUSINESS_TIMEZONE env var if needed.
const TZ = "UTC"; // used only for formatting stored Date objects (which are at UTC midnight)
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

function formatDate(date: Date): string {
  return formatInTimeZone(date, TZ, "yyyy-MM-dd");
}

// Returns the current business-tz calendar day as a UTC-midnight Date,
// matching how PG `date` columns round-trip through Prisma.
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

export interface DailyPoint {
  date: string;
  grossSales: number;
  netSales: number;
  cogs: number | null;
  units: number;
  orders: number;
}

export interface DailyByChannelPoint extends DailyPoint {
  subChannel: string;
}

export interface ChannelTotal {
  subChannel: string;
  grossSales: number;
  units: number;
  orders: number;
}

export interface SalesMetrics {
  range: { from: string; to: string; days: number; daysWithData: number };
  totals: {
    grossSales: number;
    netSales: number;
    cogs: number | null;
    grossProfit: number | null;
    units: number;
    orders: number;
    avgDailySales: number;
    topSubChannel: string | null;
    fbaFees: number | null;
    referralFees: number | null;
    refundCount: number;
    refundAmountFinancial: number | null;
  };
  daily: DailyPoint[];
  byChannel: ChannelTotal[];
  dailyByChannel: DailyByChannelPoint[];
}

export interface GetSalesMetricsArgs {
  from: Date;
  to: Date;
  channel?: string | null;
}

export async function getSalesMetrics({
  from,
  to,
  channel,
}: GetSalesMetricsArgs): Promise<SalesMetrics> {
  const rows = await db.factSalesDaily.findMany({
    where: {
      date: { gte: from, lte: to },
      ...(channel ? { channel } : {}),
    },
    orderBy: { date: "asc" },
  });

  const dailyMap = new Map<string, DailyPoint>();
  const subChannelTotals = new Map<string, ChannelTotal>();
  const dailyByChannel: DailyByChannelPoint[] = [];

  let totalGross = 0;
  let totalNet = 0;
  let totalCogs = 0;
  let cogsCoverage = 0;
  let totalUnits = 0;
  let totalOrders = 0;
  let totalFbaFees = 0;
  let totalReferralFees = 0;
  let totalRefundCount = 0;
  let totalRefundAmountFinancial = 0;
  let financialCoverage = 0;

  for (const row of rows) {
    const dateStr = formatDate(row.date);
    const gross = Number(row.grossSales);
    const net = Number(row.netSales);
    const rowCogs = row.cogs === null ? null : Number(row.cogs);
    const units = row.units;
    const orders = row.orders;

    totalGross += gross;
    totalNet += net;
    if (rowCogs !== null) {
      totalCogs += rowCogs;
      cogsCoverage++;
    }
    totalUnits += units;
    totalOrders += orders;

    const fba = row.fbaFees === null ? null : Number(row.fbaFees);
    const ref = row.referralFees === null ? null : Number(row.referralFees);
    if (fba !== null || ref !== null) {
      totalFbaFees += fba ?? 0;
      totalReferralFees += ref ?? 0;
      financialCoverage++;
    }
    totalRefundCount += row.refundCount ?? 0;
    totalRefundAmountFinancial += row.refundAmount === null ? 0 : Number(row.refundAmount);

    const day =
      dailyMap.get(dateStr) ??
      ({ date: dateStr, grossSales: 0, netSales: 0, cogs: null, units: 0, orders: 0 } as DailyPoint);
    day.grossSales += gross;
    day.netSales += net;
    if (rowCogs !== null) day.cogs = (day.cogs ?? 0) + rowCogs;
    day.units += units;
    day.orders += orders;
    dailyMap.set(dateStr, day);

    const sub = subChannelTotals.get(row.subChannel) ?? {
      subChannel: row.subChannel,
      grossSales: 0,
      units: 0,
      orders: 0,
    };
    sub.grossSales += gross;
    sub.units += units;
    sub.orders += orders;
    subChannelTotals.set(row.subChannel, sub);

    dailyByChannel.push({
      date: dateStr,
      subChannel: row.subChannel,
      grossSales: gross,
      netSales: net,
      cogs: rowCogs,
      units,
      orders,
    });
  }

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  const byChannel = Array.from(subChannelTotals.values()).sort(
    (a, b) => b.grossSales - a.grossSales,
  );

  const requestedDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);
  const daysWithData = daily.length;
  // Divide by days-with-data so partial backfills don't drag the avg toward zero.
  // requestedDays is reported separately so the UI can show coverage.
  const avgDivisor = daysWithData > 0 ? daysWithData : requestedDays;

  const cogs = cogsCoverage > 0 ? totalCogs : null;
  const grossProfit = cogs !== null ? totalNet - cogs : null;

  return {
    range: {
      from: formatDate(from),
      to: formatDate(to),
      days: requestedDays,
      daysWithData,
    },
    totals: {
      grossSales: totalGross,
      netSales: totalNet,
      cogs,
      grossProfit,
      units: totalUnits,
      orders: totalOrders,
      avgDailySales: totalGross / avgDivisor,
      topSubChannel: byChannel[0]?.subChannel ?? null,
      fbaFees: financialCoverage > 0 ? totalFbaFees : null,
      referralFees: financialCoverage > 0 ? totalReferralFees : null,
      refundCount: totalRefundCount,
      refundAmountFinancial: totalRefundAmountFinancial > 0 ? totalRefundAmountFinancial : null,
    },
    daily,
    byChannel,
    dailyByChannel,
  };
}

export function defaultRange(): { from: Date; to: Date } {
  const to = businessToday();
  const from = addDays(to, -6);
  return { from, to };
}

export function rangeFromDays(days: number): { from: Date; to: Date } {
  const clamped = Math.max(1, Math.min(365, Math.floor(days)));
  const to = businessToday();
  const from = addDays(to, -(clamped - 1));
  return { from, to };
}

export function parseDateBound(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MetricDeltas {
  grossSales: number | null;
  units: number | null;
  orders: number | null;
  avgDailySales: number | null;
  avgOrderValue: number | null;
}

export interface SalesMetricsWithComparison extends SalesMetrics {
  previousPeriod: SalesMetrics | null;
  deltas: MetricDeltas;
  avgOrderValue: number;
}

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

const SHIPPING_PER_ORDER = 6.50; // Pirate Ship blended average

export interface PeriodTotals {
  grossSales: number;
  netSales: number;
  units: number;
  orders: number;
  avgOrderValue: number;
  refundAmount: number | null;
  refundCount: number | null;
  cogs: number | null;
  adCost: number | null;
  shippingCost: number | null;
  estPayout: number | null;
  grossProfit: number | null;
  netProfit: number | null;
}

export interface PeriodCard {
  key: "today" | "yesterday" | "mtd" | "forecast" | "lastMonth";
  label: string;
  rangeLabel: string;
  current: PeriodTotals;
  previous: PeriodTotals;
  previousLabel: string;
  deltas: { grossSales: number | null; units: number | null; orders: number | null };
  isForecast?: boolean;
  forecastBasis?: { daysElapsed: number; daysInMonth: number };
}

function totalsOf(metrics: SalesMetrics, adCost: number | null = null): PeriodTotals {
  const aov =
    metrics.totals.orders > 0 ? metrics.totals.netSales / metrics.totals.orders : 0;

  const refundAmount = metrics.totals.refundAmountFinancial || null;

  const refundCount = metrics.totals.refundCount > 0 ? metrics.totals.refundCount : null;

  // est. payout = netSales − Amazon fees (when financial events data available)
  const fba = metrics.totals.fbaFees ?? 0;
  const referral = metrics.totals.referralFees ?? 0;
  const estPayout =
    metrics.totals.fbaFees !== null || metrics.totals.referralFees !== null
      ? metrics.totals.netSales - fba - referral
      : null;

  const cogs = metrics.totals.cogs || null;
  const grossProfit = metrics.totals.grossProfit;
  const shippingCost = metrics.totals.orders > 0
    ? metrics.totals.orders * SHIPPING_PER_ORDER
    : null;

  // net profit: grossProfit − adCost − shipping (fall back to estPayout for Amazon)
  const netProfit =
    grossProfit !== null && adCost !== null
      ? grossProfit - adCost - (shippingCost ?? 0)
      : estPayout !== null && adCost !== null
        ? estPayout - adCost - (shippingCost ?? 0)
        : null;

  return {
    grossSales: metrics.totals.grossSales,
    netSales: metrics.totals.netSales,
    units: metrics.totals.units,
    orders: metrics.totals.orders,
    avgOrderValue: aov,
    refundAmount,
    refundCount,
    cogs,
    adCost,
    shippingCost,
    estPayout,
    grossProfit,
    netProfit,
  };
}

function monthLabel(date: Date): string {
  return formatInTimeZone(date, TZ, "MMM");
}

function dayLabel(date: Date): string {
  return formatInTimeZone(date, TZ, "MMM d");
}

export async function getDashboardPeriods(channel?: string | null): Promise<PeriodCard[]> {
  const today = businessToday();
  const yesterday = addDays(today, -1);
  const dayBeforeYesterday = addDays(today, -2);

  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const dayOfMonth = today.getUTCDate();

  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const daysInMonth = monthEnd.getUTCDate();
  // MTD runs from month start through today; if today's data hasn't landed yet
  // the value just stays at the through-yesterday total, no special-casing needed.
  const mtdEnd = today;
  const daysElapsed = Math.max(1, dayOfMonth);

  const lastMonthStart = new Date(Date.UTC(year, month - 1, 1));
  const lastMonthEnd = new Date(Date.UTC(year, month, 0));

  const monthBeforeLastStart = new Date(Date.UTC(year, month - 2, 1));
  const monthBeforeLastEnd = new Date(Date.UTC(year, month - 1, 0));

  const mtdLastMonthStart = lastMonthStart;
  const mtdLastMonthEnd = new Date(
    Date.UTC(year, month - 1, Math.min(daysElapsed, lastMonthEnd.getUTCDate())),
  );

  async function getAdCost(from: Date, to: Date): Promise<number | null> {
    // Map sales channels to their ad platform channels.
    // shopify ← meta + tiktok (DTC social); amazon ← amazon_ads; null ← all known ad channels.
    const adChannels =
      channel === "shopify" ? ["meta", "tiktok"] :
      channel === "amazon" ? ["amazon_ads"] :
      ["meta", "tiktok", "amazon_ads"];
    const rows = await db.factAdSpendDaily.findMany({
      where: {
        date: { gte: from, lte: to },
        channel: { in: adChannels },
      },
    });
    if (rows.length === 0) return null;
    const total = rows.reduce((s, r) => s + Number(r.spend), 0);
    return total > 0 ? total : null;
  }

  const [
    todayM, yesterdayM, dayBeforeM, mtdM, mtdLastMonthM, lastMonthM, monthBeforeLastM,
    adToday, adYesterday, adDayBefore, adMtd, adMtdLast, adLastMonth, adMonthBeforeLast,
  ] = await Promise.all([
    getSalesMetrics({ from: today, to: today, channel }),
    getSalesMetrics({ from: yesterday, to: yesterday, channel }),
    getSalesMetrics({ from: dayBeforeYesterday, to: dayBeforeYesterday, channel }),
    getSalesMetrics({ from: monthStart, to: mtdEnd, channel }),
    getSalesMetrics({ from: mtdLastMonthStart, to: mtdLastMonthEnd, channel }),
    getSalesMetrics({ from: lastMonthStart, to: lastMonthEnd, channel }),
    getSalesMetrics({ from: monthBeforeLastStart, to: monthBeforeLastEnd, channel }),
    getAdCost(today, today),
    getAdCost(yesterday, yesterday),
    getAdCost(dayBeforeYesterday, dayBeforeYesterday),
    getAdCost(monthStart, mtdEnd),
    getAdCost(mtdLastMonthStart, mtdLastMonthEnd),
    getAdCost(lastMonthStart, lastMonthEnd),
    getAdCost(monthBeforeLastStart, monthBeforeLastEnd),
  ]);

  function makeDeltas(c: PeriodTotals, p: PeriodTotals) {
    return {
      grossSales: pctDelta(c.netSales, p.netSales),
      units: pctDelta(c.units, p.units),
      orders: pctDelta(c.orders, p.orders),
    };
  }

  const todayT = totalsOf(todayM, adToday);
  const yesterdayT = totalsOf(yesterdayM, adYesterday);
  const dayBeforeT = totalsOf(dayBeforeM, adDayBefore);
  const mtdT = totalsOf(mtdM, adMtd);
  const mtdLastT = totalsOf(mtdLastMonthM, adMtdLast);
  const lastMonthT = totalsOf(lastMonthM, adLastMonth);
  const monthBeforeLastT = totalsOf(monthBeforeLastM, adMonthBeforeLast);

  const mtdDaysWithData = Math.max(1, mtdM.range.daysWithData);
  const pace = mtdT.netSales / mtdDaysWithData;
  const forecastNet = pace * daysInMonth;
  const forecastGross = (mtdT.grossSales / mtdDaysWithData) * daysInMonth;
  const forecastUnits = (mtdT.units / mtdDaysWithData) * daysInMonth;
  const forecastOrders = (mtdT.orders / mtdDaysWithData) * daysInMonth;
  const mtdCogs = mtdM.totals.cogs;
  const forecastCogs = mtdCogs !== null ? (mtdCogs / mtdDaysWithData) * daysInMonth : null;
  const mtdGrossProfit = mtdM.totals.grossProfit;
  const forecastGrossProfit =
    mtdGrossProfit !== null ? (mtdGrossProfit / mtdDaysWithData) * daysInMonth : null;

  const forecastRefunds = forecastGross - forecastNet;
  const forecastT: PeriodTotals = {
    grossSales: forecastGross,
    netSales: forecastNet,
    units: forecastUnits,
    orders: forecastOrders,
    avgOrderValue: forecastOrders > 0 ? forecastNet / forecastOrders : 0,
    refundAmount: forecastRefunds > 0.01 ? forecastRefunds : null,
    refundCount: null,
    cogs: forecastCogs,
    adCost: null,
    shippingCost: forecastOrders > 0 ? forecastOrders * SHIPPING_PER_ORDER : null,
    estPayout: null,
    grossProfit: forecastGrossProfit,
    netProfit: null,
  };

  return [
    {
      key: "today",
      label: "Today",
      rangeLabel: dayLabel(today),
      current: todayT,
      previous: yesterdayT,
      previousLabel: "yesterday",
      deltas: makeDeltas(todayT, yesterdayT),
    },
    {
      key: "yesterday",
      label: "Yesterday",
      rangeLabel: dayLabel(yesterday),
      current: yesterdayT,
      previous: dayBeforeT,
      previousLabel: "day before",
      deltas: makeDeltas(yesterdayT, dayBeforeT),
    },
    {
      key: "mtd",
      label: "Month to date",
      rangeLabel: `${dayLabel(monthStart)} – ${dayLabel(mtdEnd)}`,
      current: mtdT,
      previous: mtdLastT,
      previousLabel: `same days in ${monthLabel(lastMonthStart)}`,
      deltas: makeDeltas(mtdT, mtdLastT),
    },
    {
      key: "forecast",
      label: `${monthLabel(today)} forecast`,
      rangeLabel: `pace: ${mtdDaysWithData}/${daysInMonth} days`,
      current: forecastT,
      previous: lastMonthT,
      previousLabel: `${monthLabel(lastMonthStart)} actual`,
      deltas: makeDeltas(forecastT, lastMonthT),
      isForecast: true,
      forecastBasis: { daysElapsed: mtdDaysWithData, daysInMonth },
    },
    {
      key: "lastMonth",
      label: `${monthLabel(lastMonthStart)} (last month)`,
      rangeLabel: `${dayLabel(lastMonthStart)} – ${dayLabel(lastMonthEnd)}`,
      current: lastMonthT,
      previous: monthBeforeLastT,
      previousLabel: `${monthLabel(monthBeforeLastStart)}`,
      deltas: makeDeltas(lastMonthT, monthBeforeLastT),
    },
  ];
}

export async function getSalesMetricsWithComparison(
  args: GetSalesMetricsArgs,
): Promise<SalesMetricsWithComparison> {
  const current = await getSalesMetrics(args);

  const periodDays = current.range.days;
  const prevTo = addDays(args.from, -1);
  const prevFrom = addDays(prevTo, -(periodDays - 1));
  const previous = await getSalesMetrics({
    from: prevFrom,
    to: prevTo,
    channel: args.channel,
  });

  const avgOrderValue =
    current.totals.orders > 0 ? current.totals.grossSales / current.totals.orders : 0;
  const prevAvgOrderValue =
    previous.totals.orders > 0 ? previous.totals.grossSales / previous.totals.orders : 0;

  return {
    ...current,
    avgOrderValue,
    previousPeriod: previous,
    deltas: {
      grossSales: pctDelta(current.totals.grossSales, previous.totals.grossSales),
      units: pctDelta(current.totals.units, previous.totals.units),
      orders: pctDelta(current.totals.orders, previous.totals.orders),
      avgDailySales: pctDelta(current.totals.avgDailySales, previous.totals.avgDailySales),
      avgOrderValue: pctDelta(avgOrderValue, prevAvgOrderValue),
    },
  };
}
