import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  /** Period-over-period percentage delta. null = no comparison available. */
  delta?: number | null;
  hint?: string;
}

const intFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function KpiCard({ label, value, delta, hint }: KpiCardProps) {
  const positive = delta !== undefined && delta !== null && delta >= 0;
  const negative = delta !== undefined && delta !== null && delta < 0;

  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        <div className="text-2xl font-semibold tabular-nums mt-1.5 leading-tight">{value}</div>
        <div className="flex items-baseline gap-2 mt-1 text-xs">
          {delta !== undefined && delta !== null ? (
            <span
              className={cn(
                "tabular-nums font-medium",
                positive && "text-emerald-500",
                negative && "text-rose-500",
              )}
            >
              {positive ? "▲" : "▼"} {intFmt.format(Math.abs(delta))}%
            </span>
          ) : delta === null ? (
            <span className="text-muted-foreground">— no prior data</span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
