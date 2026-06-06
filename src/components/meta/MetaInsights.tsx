import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import type { MetaAlert, MetaAlertSeverity } from "@/lib/meta-metrics";
import { cn } from "@/lib/utils";

// Read-only flagged insights. We surface *what* to look at (ROAS below target,
// zero-purchase spend, frequency fatigue) without taking action on Meta.
const STYLES: Record<MetaAlertSeverity, { wrap: string; icon: typeof Info }> = {
  critical: { wrap: "text-rose-600 dark:text-rose-400", icon: OctagonAlert },
  warn: { wrap: "text-amber-600 dark:text-amber-400", icon: AlertTriangle },
  info: { wrap: "text-sky-600 dark:text-sky-400", icon: Info },
};

export function MetaInsights({ alerts }: { alerts: MetaAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-3 text-center">
        No flags — every active campaign is hitting its targets.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {alerts.map((a, i) => {
        const s = STYLES[a.severity];
        const Icon = s.icon;
        return (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Icon size={15} className={cn("mt-0.5 shrink-0", s.wrap)} />
            <span>
              <span className="font-medium text-foreground">{a.scope}</span>
              <span className="text-muted-foreground"> — {a.message}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
