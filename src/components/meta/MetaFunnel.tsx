import type { MetaMetrics } from "@/lib/meta-metrics";
import { fmtInt, fmtPct, fmtUsd2 } from "./format";

// Conversion funnel: each stage shows volume, step-through rate from the prior
// stage, and cost-per-action — the standard view agencies use to spot where
// spend leaks (e.g. strong CTR but weak ATC→purchase).
interface Stage {
  label: string;
  count: number;
  cost: number | null; // cost per action
  rate: number | null; // % through from previous stage
}

function pct(a: number, b: number): number | null {
  return b > 0 ? (a / b) * 100 : null;
}

export function MetaFunnel({ m }: { m: MetaMetrics }) {
  const stages: Stage[] = [
    { label: "Impressions", count: m.impressions, cost: null, rate: null },
    { label: "Link clicks", count: m.inlineLinkClicks, cost: m.cpc, rate: pct(m.inlineLinkClicks, m.impressions) },
    { label: "Landing views", count: m.landingPageViews, cost: null, rate: pct(m.landingPageViews, m.inlineLinkClicks) },
    { label: "Add to cart", count: m.addToCart, cost: m.costPerAtc, rate: pct(m.addToCart, m.landingPageViews) },
    { label: "Checkout", count: m.initiateCheckout, cost: m.costPerIc, rate: pct(m.initiateCheckout, m.addToCart) },
    { label: "Purchases", count: m.purchases, cost: m.cpa, rate: pct(m.purchases, m.initiateCheckout) },
  ];

  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-2.5">
      {stages.map((s, i) => (
        <div key={s.label} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="font-medium text-foreground">{s.label}</span>
            <span className="flex items-baseline gap-3 tabular-nums">
              {s.rate !== null ? (
                <span className="text-muted-foreground text-[11px]">{fmtPct(s.rate)} →</span>
              ) : null}
              {s.cost !== null ? (
                <span className="text-muted-foreground text-[11px]">{fmtUsd2(s.cost)}</span>
              ) : null}
              <span className="font-semibold text-foreground w-16 text-right">{fmtInt(s.count)}</span>
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary/70"
              style={{ width: `${Math.max((s.count / max) * 100, i === 0 ? 100 : 1.5)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
