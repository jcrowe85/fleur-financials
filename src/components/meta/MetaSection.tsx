import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  computeMetaInsights,
  getAccountMetrics,
  getMetaHierarchy,
  getMetaPeriodCards,
  getMetaTrend,
  hasMetaData,
  resolveMetaPeriod,
  ROAS_TARGET,
} from "@/lib/meta-metrics";
import { MetaFunnel } from "./MetaFunnel";
import { MetaHierarchyTable } from "./MetaHierarchyTable";
import { MetaInsights } from "./MetaInsights";
import { MetaKpiRow } from "./MetaKpiRow";
import { MetaPeriodCards } from "./MetaPeriodCards";
import { MetaPeriodToggle } from "./MetaPeriodToggle";
import { MetaTrendChart } from "./MetaTrendChart";

// Agency-grade Meta Ads section, integrated into the main dashboard. Has its
// own period selector (the `mp` search param) independent of the sales range.
export async function MetaSection({ mp, heading = false }: { mp?: string; heading?: boolean }) {
  if (!(await hasMetaData())) {
    if (!heading) return null;
    return (
      <div className="py-20 text-center text-sm text-muted-foreground">
        No Meta data yet. Run a sync (<code className="font-mono">/api/sync/meta?days=30</code>) to populate the dashboard.
      </div>
    );
  }

  const period = resolveMetaPeriod(mp);

  const [cards, current, previous, trend, campaigns] = await Promise.all([
    getMetaPeriodCards(),
    getAccountMetrics(period.from, period.to),
    getAccountMetrics(period.prevFrom, period.prevTo),
    getMetaTrend(period.from, period.to),
    getMetaHierarchy(period.from, period.to),
  ]);

  const alerts = computeMetaInsights(campaigns);

  return (
    <section id="meta" className="space-y-4 scroll-mt-4">
      <div
        className={
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" +
          (heading ? " border-b pb-4" : " border-t pt-5")
        }
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex size-5 items-center justify-center rounded bg-[#0866FF] text-white text-[11px] font-bold shrink-0">
            f
          </span>
          <span
            className={
              "font-semibold tracking-tight text-foreground" + (heading ? " text-xl" : " text-base")
            }
          >
            Meta Ads
          </span>
          {alerts.length > 0 ? (
            <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {alerts.length} flag{alerts.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <MetaPeriodToggle value={period.key} />
      </div>

      {/* Quick-glance pacing strip */}
      <MetaPeriodCards cards={cards} />

      {/* Selected-period detail */}
      <div className="flex items-baseline gap-2 text-xs uppercase tracking-wide text-muted-foreground pt-1">
        {period.label}
        <span className="normal-case tracking-normal text-foreground/50">{period.rangeLabel}</span>
        <span className="normal-case tracking-normal">· vs {period.prevLabel}</span>
      </div>

      <MetaKpiRow current={current} previous={previous} />

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Spend vs revenue & ROAS</CardTitle>
          </CardHeader>
          <CardContent>
            <MetaTrendChart data={trend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Conversion funnel</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <MetaFunnel m={current} />
          </CardContent>
        </Card>
      </div>

      {alerts.length > 0 ? (
        <Card className="border-amber-500/30 bg-amber-500/[0.03]">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Flagged insights{" "}
              <span className="text-muted-foreground font-normal">· ROAS target {ROAS_TARGET.toFixed(1)}×</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MetaInsights alerts={alerts} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Campaign breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <MetaHierarchyTable campaigns={campaigns} roasTarget={ROAS_TARGET} />
        </CardContent>
      </Card>
    </section>
  );
}
