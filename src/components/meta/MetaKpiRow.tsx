import { KpiCard } from "@/components/KpiCard";
import type { MetaMetrics } from "@/lib/meta-metrics";
import { pctDelta } from "@/lib/meta-metrics";
import { fmtInt, fmtPct, fmtRatio, fmtRoas, fmtUsd, fmtUsd2 } from "./format";

// Full KPI grid for the selected period, each tile with a period-over-period
// delta. Cost metrics (CPA/CPM/CPC) read "down is good", so their deltas are
// shown raw (KpiCard colours up=green) — we pass the inverted sign for those.
export function MetaKpiRow({ current, previous }: { current: MetaMetrics; previous: MetaMetrics }) {
  // For cost-style metrics a *decrease* is good, so flip the delta sign so the
  // KpiCard's green/red colouring reads correctly.
  const costDelta = (cur: number | null, prev: number | null): number | null => {
    const d = cur !== null && prev !== null ? pctDelta(cur, prev) : null;
    return d === null ? null : -d;
  };
  const d = (cur: number | null, prev: number | null): number | null =>
    cur !== null && prev !== null ? pctDelta(cur, prev) : null;

  return (
    <section className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
      <KpiCard label="Spend" value={fmtUsd(current.spend)} delta={costDelta(current.spend, previous.spend)} />
      <KpiCard label="Revenue" value={fmtUsd(current.purchaseValue)} delta={d(current.purchaseValue, previous.purchaseValue)} />
      <KpiCard label="ROAS" value={fmtRoas(current.roas)} delta={d(current.roas, previous.roas)} />
      <KpiCard label="Purchases" value={fmtInt(current.purchases)} delta={d(current.purchases, previous.purchases)} />
      <KpiCard label="CPA" value={fmtUsd2(current.cpa)} delta={costDelta(current.cpa, previous.cpa)} />
      <KpiCard label="AOV" value={fmtUsd2(current.aov)} delta={d(current.aov, previous.aov)} />
      <KpiCard label="CPM" value={fmtUsd2(current.cpm)} delta={costDelta(current.cpm, previous.cpm)} />
      <KpiCard label="CPC" value={fmtUsd2(current.cpc)} delta={costDelta(current.cpc, previous.cpc)} />
      <KpiCard label="CTR" value={fmtPct(current.ctr)} delta={d(current.ctr, previous.ctr)} />
      <KpiCard label="Link CTR" value={fmtPct(current.linkCtr)} delta={d(current.linkCtr, previous.linkCtr)} />
      <KpiCard label="Frequency" value={fmtRatio(current.frequency)} delta={costDelta(current.frequency, previous.frequency)} hint="approx" />
      <KpiCard label="Avg daily spend" value={fmtUsd(current.avgDailySpend)} hint={`/ ${current.daysWithData}d`} />
    </section>
  );
}
