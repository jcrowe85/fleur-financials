import { formatInTimeZone } from "date-fns-tz";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DailyTable } from "@/components/DailyTable";
import { KpiCard } from "@/components/KpiCard";
import { MarketplaceChart } from "@/components/MarketplaceChart";
import { PeriodCards } from "@/components/PeriodCards";
import { RangePicker } from "@/components/RangePicker";
import { SalesChart } from "@/components/SalesChart";
import { AutoRefresh } from "@/components/AutoRefresh";
import { SyncCountdown } from "@/components/SyncCountdown";
import {
  defaultRange,
  getDashboardPeriods,
  getSalesMetricsWithComparison,
  parseDateBound,
  rangeFromDays,
} from "@/lib/metrics";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const currencyFmtCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const numberFmt = new Intl.NumberFormat("en-US");

interface PageProps {
  searchParams: Promise<{ days?: string; from?: string; to?: string; channel?: string; mp?: string }>;
}

function rangeFromParams(params: Awaited<PageProps["searchParams"]>): {
  from: Date;
  to: Date;
} {
  const explicitFrom = parseDateBound(params.from);
  const explicitTo = parseDateBound(params.to);
  if (explicitFrom && explicitTo) return { from: explicitFrom, to: explicitTo };
  if (params.days) return rangeFromDays(Number(params.days));
  return defaultRange();
}

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const { from, to } = rangeFromParams(params);

  const channel = params.channel ?? null;
  const [metrics, allPeriods, shopifyPeriods, amazonPeriods, lastSync] = await Promise.all([
    getSalesMetricsWithComparison({ from, to, channel }),
    getDashboardPeriods(null),
    getDashboardPeriods("shopify"),
    getDashboardPeriods("amazon"),
    db.syncLog.findFirst({
      orderBy: { startedAt: "desc" },
    }),
  ]);

  const fromLabel = formatInTimeZone(from, "UTC", "MMM d, yyyy");
  const toLabel = formatInTimeZone(to, "UTC", "MMM d, yyyy");
  const isSparse =
    metrics.range.daysWithData > 0 && metrics.range.daysWithData < metrics.range.days;

  const bestDay = metrics.daily.reduce<typeof metrics.daily[number] | null>(
    (best, d) => (!best || d.grossSales > best.grossSales ? d : best),
    null,
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AutoRefresh />
      <div className="mx-auto max-w-[1600px] px-4 py-4 space-y-5 sm:px-6 sm:py-6 sm:space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Fleur Sales</h1>
            <p className="text-lg font-medium tabular-nums mt-1">
              {fromLabel} <span className="text-muted-foreground">→</span> {toLabel}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              {metrics.range.daysWithData} of {metrics.range.days} days with data
              {lastSync ? (
                <>
                  {" · Last sync: "}
                  {lastSync.finishedAt
                    ? formatInTimeZone(lastSync.finishedAt, "UTC", "MMM d, HH:mm 'UTC'")
                    : "running…"}
                </>
              ) : (
                " · No sync runs yet"
              )}
              <SyncCountdown />
            </p>
          </div>
          <div className="flex items-center gap-3">
            <RangePicker />
          </div>
        </header>

        {lastSync?.status === "error" || lastSync?.status === "partial" ? (
          <Card
            className={
              lastSync.status === "error"
                ? "border-destructive/50 bg-destructive/5 py-3"
                : "border-amber-500/40 bg-amber-500/5 py-3"
            }
          >
            <CardContent className="py-2 text-sm">
              <div
                className={
                  lastSync.status === "error" ? "font-medium text-destructive" : "font-medium text-amber-600 dark:text-amber-400"
                }
              >
                Last sync {lastSync.status === "error" ? "failed" : "completed with errors"}
              </div>
              <div className="text-muted-foreground mt-1 font-mono text-xs">
                {lastSync.errorMessage ?? "Unknown error"}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {isSparse ? (
          <Card className="border-amber-500/40 bg-amber-500/5 py-3">
            <CardContent className="py-2 text-sm text-amber-700 dark:text-amber-300">
              Only {metrics.range.daysWithData} of {metrics.range.days} days in this range have data
              ({fromLabel} → {toLabel}).
            </CardContent>
          </Card>
        ) : null}

        <PeriodCards label="All channels" periods={allPeriods} collapsible />
        <PeriodCards label="Shopify" periods={shopifyPeriods} accent="emerald" />
        <PeriodCards label="Amazon" periods={amazonPeriods} accent="amber" />

        <details className="text-xs text-muted-foreground -mt-2">
          <summary className="cursor-pointer hover:text-foreground transition-colors inline">
            Why are Refunds / Ad cost / Profit showing —?
          </summary>
          <div className="mt-2 pl-4 space-y-1 leading-relaxed">
            <p>
              <span className="font-medium text-foreground">Refunds $</span> — needs Amazon SP-API
              financial events (refund amount, not just units).
            </p>
            <p>
              <span className="font-medium text-foreground">Ad cost</span> — Amazon Ads syncs
              automatically (two-phase: submit → download ~15 min later). Meta ad cost requires
              a valid Meta access token.
            </p>
            <p>
              <span className="font-medium text-foreground">Est. payout</span> — settlement report
              from Amazon, or estimate as sales × (1 − referral fee − FBA fee) once COGS file is
              loaded.
            </p>
            <p>
              <span className="font-medium text-foreground">Gross / Net profit</span> — upload a
              per-SKU COGS file; then gross = sales − COGS, net = gross − ad cost − fees − refunds.
            </p>
          </div>
        </details>

        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground pt-2 border-t">
          Selected range
        </div>

        <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            label="Sales"
            value={currencyFmt.format(metrics.totals.grossSales)}
            delta={metrics.deltas.grossSales}
          />
          <KpiCard
            label="Units"
            value={numberFmt.format(metrics.totals.units)}
            delta={metrics.deltas.units}
          />
          <KpiCard
            label="Orders"
            value={numberFmt.format(metrics.totals.orders)}
            delta={metrics.deltas.orders}
          />
          <KpiCard
            label="AOV"
            value={currencyFmtCents.format(metrics.avgOrderValue)}
            delta={metrics.deltas.avgOrderValue}
          />
          <KpiCard
            label="Avg Daily"
            value={currencyFmt.format(metrics.totals.avgDailySales)}
            delta={metrics.deltas.avgDailySales}
            hint={`/ ${metrics.range.daysWithData}d`}
          />
          <KpiCard
            label="Top market"
            value={metrics.totals.topSubChannel ?? "—"}
            hint={
              metrics.byChannel[0]
                ? currencyFmt.format(metrics.byChannel[0].grossSales)
                : undefined
            }
          />
        </section>

        {bestDay ? (
          <div className="text-xs text-muted-foreground -mt-2">
            Best day in range:{" "}
            <span className="text-foreground font-medium">
              {bestDay.date} ({currencyFmt.format(bestDay.grossSales)})
            </span>
          </div>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Daily sales</CardTitle>
            </CardHeader>
            <CardContent>
              <SalesChart data={metrics.daily} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sales by marketplace</CardTitle>
            </CardHeader>
            <CardContent>
              <MarketplaceChart data={metrics.dailyByChannel} />
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Daily breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {metrics.daily.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No data in this range.
              </p>
            ) : (
              <DailyTable
                daily={metrics.daily}
                dailyByChannel={metrics.dailyByChannel}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
