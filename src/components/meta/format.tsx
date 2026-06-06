import { cn } from "@/lib/utils";

// Shared formatters + tiny presentational bits for the Meta section. Plain
// functions / hook-free components so they work in both server and client
// components.

const usd0Fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2Fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat("en-US");
const num1Fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num2Fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtUsd = (v: number | null): string => (v === null ? "—" : usd0Fmt.format(v));
export const fmtUsd2 = (v: number | null): string => (v === null ? "—" : usd2Fmt.format(v));
export const fmtInt = (v: number | null): string => (v === null ? "—" : intFmt.format(Math.round(v)));
export const fmtPct = (v: number | null): string => (v === null ? "—" : `${num1Fmt.format(v)}%`);
export const fmtRoas = (v: number | null): string => (v === null ? "—" : `${num2Fmt.format(v)}×`);
export const fmtRatio = (v: number | null): string => (v === null ? "—" : num2Fmt.format(v));

/** Period-over-period delta chip. `goodWhenDown` flips colours for cost metrics. */
export function Delta({ value, goodWhenDown = false }: { value: number | null; goodWhenDown?: boolean }) {
  if (value === null) return <span className="text-muted-foreground tabular-nums">—</span>;
  const up = value >= 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className={cn("tabular-nums font-medium", good ? "text-emerald-500" : "text-rose-500")}>
      {up ? "▲" : "▼"} {num1Fmt.format(Math.abs(value))}%
    </span>
  );
}

/** Colour a ROAS value relative to target (green ≥ target, amber near, rose below). */
export function roasClass(roas: number | null, target: number): string {
  if (roas === null) return "text-muted-foreground";
  if (roas >= target) return "text-emerald-500";
  if (roas >= target * 0.6) return "text-amber-500";
  return "text-rose-500";
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-500",
  PAUSED: "bg-muted-foreground/50",
  ARCHIVED: "bg-muted-foreground/30",
  DELETED: "bg-muted-foreground/30",
};

/** Small status dot used in the hierarchy table. */
export function StatusDot({ status }: { status: string | null }) {
  const s = status ?? "";
  const color = STATUS_STYLES[s] ?? "bg-amber-500";
  return (
    <span
      className={cn("inline-block size-2 rounded-full shrink-0", color)}
      title={s || "unknown"}
    />
  );
}
