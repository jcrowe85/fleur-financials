import { Card, CardContent } from "@/components/ui/card";
import type { PeriodCard, PeriodTotals } from "@/lib/metrics";
import { cn } from "@/lib/utils";

interface PeriodCardsProps {
  periods: PeriodCard[];
  label?: string;
  /** Color accent for the section dot. */
  accent?: "indigo" | "emerald" | "amber";
}

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
const pctFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground tabular-nums">—</span>;
  const positive = value >= 0;
  return (
    <span
      className={cn(
        "tabular-nums font-medium",
        positive ? "text-emerald-500" : "text-rose-500",
      )}
    >
      {positive ? "▲" : "▼"} {pctFmt.format(Math.abs(value))}%
    </span>
  );
}

interface RowProps {
  label: string;
  value: string | null;
  /** When true, render the value muted (e.g. cost lines). */
  negative?: boolean;
  /** When true, value is bold (e.g. final profit). */
  bold?: boolean;
}

function MetricRow({ label, value, negative, bold }: RowProps) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "font-semibold text-foreground" : "text-foreground/90",
          value === null && "text-muted-foreground",
          negative && value !== null && "text-rose-500/80",
        )}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function fmtCurrency(value: number | null, withCents = false): string | null {
  if (value === null) return null;
  return (withCents ? currencyFmtCents : currencyFmt).format(value);
}

function fmtUnits(t: PeriodTotals): string {
  return `${numberFmt.format(Math.round(t.units))} / ${numberFmt.format(
    Math.round(t.orders),
  )}`;
}

const ACCENT_STYLES: Record<NonNullable<PeriodCardsProps["accent"]>, string> = {
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
};

export function PeriodCards({ periods, label, accent = "indigo" }: PeriodCardsProps) {
  return (
    <section className="space-y-2">
      {label ? (
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground font-medium">
          <span className={cn("h-2 w-2 rounded-full", ACCENT_STYLES[accent])} />
          {label}
        </div>
      ) : null}
      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
        {periods.map((p) => {
        const t = p.current;
        return (
          <Card
            key={p.key}
            className={cn(
              "gap-0 py-4",
              p.isForecast && "border-sky-500/30 bg-sky-500/[0.03]",
            )}
          >
            <CardContent className="px-4 space-y-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {p.label}
                </span>
                <span className="text-xs tabular-nums text-foreground/80 font-medium">
                  {p.rangeLabel}
                </span>
              </div>

              <div>
                <div className="text-[26px] font-semibold tabular-nums leading-none">
                  {currencyFmt.format(t.netSales)}
                  {p.isForecast ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-sky-500 font-medium align-middle">
                      Forecast
                    </span>
                  ) : null}
                </div>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                  <Delta value={p.deltas.grossSales} />
                  <span className="text-muted-foreground truncate">
                    vs {p.previousLabel}
                  </span>
                </div>
              </div>

              <div className="space-y-1 pt-2 border-t border-border/60">
                <MetricRow label="Gross sales" value={fmtCurrency(t.grossSales)} />
                <MetricRow label="Units / orders" value={fmtUnits(t)} />
                <MetricRow label="Refunds / disc." value={fmtCurrency(t.refundAmount)} negative />
                <MetricRow label="Ad cost" value={fmtCurrency(t.adCost)} negative />
                <MetricRow label="Est. payout" value={fmtCurrency(t.estPayout)} />
                <MetricRow label="Gross profit" value={fmtCurrency(t.grossProfit)} />
                <MetricRow label="Net profit" value={fmtCurrency(t.netProfit)} bold />
              </div>
            </CardContent>
          </Card>
        );
      })}
      </div>
    </section>
  );
}
