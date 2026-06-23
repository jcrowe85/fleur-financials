"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ChannelIcon } from "@/components/ChannelIcon";
import type { PeriodCard, PeriodTotals } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface PeriodCardsProps {
  periods: PeriodCard[];
  label?: string;
  accent?: "indigo" | "emerald" | "amber";
  /** Collapse sub-metrics behind a toggle arrow (used for All Channels). */
  collapsible?: boolean;
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const numberFmt = new Intl.NumberFormat("en-US");
const pctFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground tabular-nums">—</span>;
  const positive = value >= 0;
  return (
    <span className={cn("tabular-nums font-medium", positive ? "text-emerald-500" : "text-rose-500")}>
      {positive ? "▲" : "▼"} {pctFmt.format(Math.abs(value))}%
    </span>
  );
}

interface TileProps {
  label: string;
  value: string | null;
  negative?: boolean;
  bold?: boolean;
  wide?: boolean;
}

function MetricTile({ label, value, negative, bold, wide }: TileProps) {
  return (
    <div className={cn("space-y-0.5", wide && "col-span-2")}>
      <div className="text-[11px] text-muted-foreground leading-none truncate">{label}</div>
      <div
        className={cn(
          "text-[15px] tabular-nums leading-snug",
          bold ? "font-semibold text-foreground" : "font-medium text-foreground/90",
          value === null && "text-muted-foreground",
          negative && value !== null && "text-rose-500/80",
        )}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

function fmtCurrency(value: number | null): string | null {
  if (value === null || value === 0) return null;
  return currencyFmt.format(value);
}

function fmtUnits(t: PeriodTotals): string {
  return `${numberFmt.format(Math.round(t.units))} / ${numberFmt.format(Math.round(t.orders))}`;
}

const ACCENT_STYLES: Record<NonNullable<PeriodCardsProps["accent"]>, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
};

function SubMetrics({ t, showRefunds }: { t: PeriodTotals; showRefunds: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-border/60">
      <MetricTile label="Gross sales" value={fmtCurrency(t.grossSales)} />
      <MetricTile label="Units / orders" value={fmtUnits(t)} />
      <MetricTile label="COGS" value={fmtCurrency(t.cogs)} negative />
      <MetricTile label="Shipping" value={fmtCurrency(t.shippingCost)} negative />
      <MetricTile label="Ad cost" value={fmtCurrency(t.adCost)} negative />
      {showRefunds && (
        <MetricTile label="Returns" value={fmtCurrency(t.refundAmount)} negative />
      )}
      <MetricTile label="Gross profit" value={fmtCurrency(t.grossProfit)} />
      <MetricTile label="Net profit" value={fmtCurrency(t.netProfit)} bold />
    </div>
  );
}

// The pace card has no cost/profit data — it's a sales-pace signal — so show a
// slim breakdown instead of rows of dashes: today's gross + units/orders, and
// the prior-day baseline it's being compared against.
function PaceSubMetrics({ t, prev, previousLabel }: { t: PeriodTotals; prev: PeriodTotals; previousLabel: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-3 border-t border-border/60">
      <MetricTile label="Gross sales" value={fmtCurrency(t.grossSales)} />
      <MetricTile label="Units / orders" value={fmtUnits(t)} />
      <MetricTile label={previousLabel} value={fmtCurrency(prev.netSales)} wide />
    </div>
  );
}

function PrimaryMetric({ p, t }: { p: PeriodCard; t: PeriodTotals }) {
  return (
    <div>
      <div className="text-[28px] font-semibold tabular-nums leading-none">
        {currencyFmt.format(t.netSales)}
        {p.isForecast ? (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-500 font-medium align-middle">
            Forecast
          </span>
        ) : null}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
        <Delta value={p.deltas.grossSales} />
        <span className="text-muted-foreground truncate">vs {p.previousLabel}</span>
      </div>
    </div>
  );
}

export function PeriodCards({ periods, label, accent = "indigo", collapsible = false }: PeriodCardsProps) {
  const [open, setOpen] = useState(true);

  return (
    <section className="space-y-2">
      {label ? (
        <div className="flex items-center gap-2">
          <ChannelIcon label={label} />
          <span className="text-base font-semibold tracking-tight text-foreground">
            {label}
          </span>
          {collapsible && (
            <button
              onClick={() => setOpen(o => !o)}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              {open ? "Hide" : "Show"}
            </button>
          )}
        </div>
      ) : null}

      {/* Mobile: horizontal snap-scroll carousel; desktop: grid */}
      <div className={cn(
        // Mobile carousel
        "flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth pb-2 -mx-4 pl-5 pr-4 sm:mx-0 sm:px-0 sm:pb-0",
        // Desktop grid
        "sm:grid sm:overflow-visible sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6",
        !open && collapsible && "hidden",
      )}>
        {periods.map((p) => {
          const t = p.current;
          return (
            <Card
              key={p.key}
              className={cn(
                "gap-0 py-0 snap-start shrink-0 w-[82vw] sm:w-auto",
                p.isForecast && "border-sky-500/30 bg-sky-500/[0.03]",
              )}
            >
              <CardContent className="px-4 py-4 space-y-4 sm:px-5 sm:py-5">
                {/* Header */}
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {p.label}
                  </span>
                  <span className="text-xs tabular-nums text-foreground/60 font-medium shrink-0">
                    {p.rangeLabel}
                  </span>
                </div>

                <PrimaryMetric p={p} t={t} />
                {p.isPace ? (
                  <PaceSubMetrics t={t} prev={p.previous} previousLabel={p.previousLabel} />
                ) : (
                  <SubMetrics t={t} showRefunds={true} />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
