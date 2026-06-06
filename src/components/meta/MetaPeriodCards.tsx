import { Card, CardContent } from "@/components/ui/card";
import type { MetaPeriodCard } from "@/lib/meta-metrics";
import { ROAS_TARGET } from "@/lib/meta-metrics";
import { Delta, fmtRoas, fmtUsd, roasClass } from "./format";

// At-a-glance strip: Today / Yesterday / 7d / 30d / MTD, each with spend,
// revenue, ROAS (colour-coded vs target) and a spend delta — so the operator
// sees the whole pacing picture without touching the period toggle.
export function MetaPeriodCards({ cards }: { cards: MetaPeriodCard[] }) {
  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.key} className="gap-0 py-0">
          <CardContent className="px-4 py-4 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {c.label}
              </span>
              <span className="text-[10px] tabular-nums text-foreground/50 shrink-0">{c.rangeLabel}</span>
            </div>

            <div className="text-[22px] font-semibold tabular-nums leading-none">{fmtUsd(c.spend)}</div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Delta value={c.deltas.spend} />
              <span className="text-muted-foreground">spend</span>
            </div>

            <div className="flex items-center justify-between pt-1.5 border-t border-border/60 text-[12px]">
              <span className="text-muted-foreground">ROAS</span>
              <span className={`tabular-nums font-semibold ${roasClass(c.roas, ROAS_TARGET)}`}>
                {fmtRoas(c.roas)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">Revenue</span>
              <span className="tabular-nums text-foreground/90">{fmtUsd(c.revenue)}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
