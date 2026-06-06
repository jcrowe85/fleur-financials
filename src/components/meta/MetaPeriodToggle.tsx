"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { META_PERIOD_OPTIONS, type MetaPeriodKey } from "@/lib/meta-metrics";

// Segmented control that drives the Meta section via the `mp` search param.
// Mirrors RangePicker's searchParam pattern but renders as inline pills so the
// active period reads at a glance (the agency-dashboard convention).
export function MetaPeriodToggle({ value }: { value: MetaPeriodKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function select(key: string) {
    const params = new URLSearchParams(searchParams);
    params.set("mp", key);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div
      className={cn(
        "inline-flex flex-wrap items-center gap-1 rounded-lg border bg-card p-1",
        isPending && "opacity-60",
      )}
    >
      {META_PERIOD_OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            onClick={() => select(opt.key)}
            disabled={isPending}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
