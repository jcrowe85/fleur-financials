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
  let cogsCoverage = 0; // number of rows that reported COGS
  let totalUnits = 0;
  let totalOrders = 0;

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

export interface PeriodTotals {
  grossSales: number;
  netSales: number;
  units: number;
  orders: number;
  avgOrderValue: number;
  // The following are channel-specific or require extra data sources.
  // Null means "data source not connected yet". Wired up as we add connectors:
  //   refundAmount → Amazon SP-API financial events
  //   adCost       → Amazon Ads + TikTok Ads + Meta Ads connectors
  //   estPayout    → sales − fees − refunds (settlement report)
  //   grossProfit  → sales − COGS (user-uploaded COGS file)
  //   netProfit    → grossProfit − adCost − fees − refunds
  refundAmount: number | null;
  adCost: number | null;
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

function totalsOf(metrics: SalesMetrics): PeriodTotals {
  const aov =
    metrics.totals.orders > 0 ? metrics.totals.netSales / metrics.totals.orders : 0;
  // "Refunds" line = the dollar value subtracted from gross to get net
  // (covers Shopify discounts + returns; null for sources where we can't tell).
  const diff = metrics.totals.grossSales - metrics.totals.netSales;
  const refundAmount = diff > 0.01 ? diff : null;
  return {
    grossSales: metrics.totals.grossSales,
    netSales: metrics.totals.netSales,
    units: metrics.totals.units,
    orders: metrics.totals.orders,
    avgOrderValue: aov,
    refundAmount,
    adCost: null,
    estPayout: null,
    grossProfit: metrics.totals.grossProfit,
    netProfit: null,
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

  const [
    todayM,
    yesterdayM,
    dayBeforeM,
    mtdM,
    mtdLastMonthM,
    lastMonthM,
    monthBeforeLastM,
  ] = await Promise.all([
    getSalesMetrics({ from: today, to: today, channel }),
    getSalesMetrics({ from: yesterday, to: yesterday, channel }),
    getSalesMetrics({ from: dayBeforeYesterday, to: dayBeforeYesterday, channel }),
    getSalesMetrics({ from: monthStart, to: mtdEnd, channel }),
    getSalesMetrics({ from: mtdLastMonthStart, to: mtdLastMonthEnd, channel }),
    getSalesMetrics({ from: lastMonthStart, to: lastMonthEnd, channel }),
    getSalesMetrics({ from: monthBeforeLastStart, to: monthBeforeLastEnd, channel }),
  ]);

  function makeDeltas(c: PeriodTotals, p: PeriodTotals) {
    return {
      // Compare net since net is the headline number now.
      grossSales: pctDelta(c.netSales, p.netSales),
      units: pctDelta(c.units, p.units),
      orders: pctDelta(c.orders, p.orders),
    };
  }

  const todayT = totalsOf(todayM);
  const yesterdayT = totalsOf(yesterdayM);
  const dayBeforeT = totalsOf(dayBeforeM);
  const mtdT = totalsOf(mtdM);
  const mtdLastT = totalsOf(mtdLastMonthM);
  const lastMonthT = totalsOf(lastMonthM);
  const monthBeforeLastT = totalsOf(monthBeforeLastM);

  const mtdDaysWithData = Math.max(1, mtdM.range.daysWithData);
  const pace = mtdT.netSales / mtdDaysWithData;
  const forecastNet = pace * daysInMonth;
  const forecastGross = (mtdT.grossSales / mtdDaysWithData) * daysInMonth;
  const forecastUnits = (mtdT.units / mtdDaysWithData) * daysInMonth;
  const forecastOrders = (mtdT.orders / mtdDaysWithData) * daysInMonth;
  // Forecast gross profit: scale MTD gross profit by same factor as sales.
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
    adCost: null,
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
