"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import type {
  MetaAdNode,
  MetaAdsetNode,
  MetaCampaignNode,
  MetaMetrics,
} from "@/lib/meta-metrics";
import { cn } from "@/lib/utils";
import { fmtInt, fmtPct, fmtRatio, fmtRoas, fmtUsd, fmtUsd2, roasClass, StatusDot } from "./format";

// Campaign → Ad Set → Ad drill-down. Rows expand in place; columns are
// sortable and apply at every level. This is the heart of the agency view:
// scan spend/ROAS across the tree, then drill into the ads doing the work.

type SortKey =
  | "spend"
  | "purchaseValue"
  | "roas"
  | "purchases"
  | "cpa"
  | "cpm"
  | "ctr"
  | "hookRate"
  | "holdRate"
  | "frequency";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "spend", label: "Spend" },
  { key: "purchaseValue", label: "Revenue" },
  { key: "roas", label: "ROAS" },
  { key: "purchases", label: "Purch" },
  { key: "cpa", label: "CPA" },
  { key: "cpm", label: "CPM" },
  { key: "ctr", label: "CTR" },
  { key: "hookRate", label: "Hook" },
  { key: "holdRate", label: "Hold" },
  { key: "frequency", label: "Freq" },
];

function cmp(a: MetaMetrics, b: MetaMetrics, key: SortKey, dir: 1 | -1): number {
  const av = a[key];
  const bv = b[key];
  // nulls always sort last regardless of direction
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return (av - bv) * dir;
}

function budgetChip(daily: number | null, lifetime: number | null): string | null {
  if (daily !== null) return `${fmtUsd(daily)}/day`;
  if (lifetime !== null) return `${fmtUsd(lifetime)} total`;
  return null;
}

export function MetaHierarchyTable({
  campaigns,
  roasTarget,
}: {
  campaigns: MetaCampaignNode[];
  roasTarget: number;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set());

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === -1 ? 1 : -1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }
  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  };

  const sortedCampaigns = useMemo(
    () => [...campaigns].sort((a, b) => cmp(a.metrics, b.metrics, sortKey, sortDir)),
    [campaigns, sortKey, sortDir],
  );

  const sortRows = <T extends { metrics: MetaMetrics }>(rows: T[]): T[] =>
    [...rows].sort((a, b) => cmp(a.metrics, b.metrics, sortKey, sortDir));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-separate border-spacing-0">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-medium py-2 pr-4 sticky left-0 bg-card z-10 min-w-[260px]">
              Campaign / Ad set / Ad
            </th>
            {COLUMNS.map((col) => (
              <th key={col.key} className="text-right font-medium py-2 pl-4 whitespace-nowrap">
                <button
                  onClick={() => toggleSort(col.key)}
                  className={cn(
                    "hover:text-foreground transition-colors inline-flex items-center gap-0.5",
                    sortKey === col.key && "text-foreground",
                  )}
                >
                  {col.label}
                  {sortKey === col.key ? <span>{sortDir === -1 ? "▼" : "▲"}</span> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedCampaigns.map((c) => {
            const open = openCampaigns.has(c.id);
            return (
              <CampaignRows
                key={c.id}
                campaign={c}
                open={open}
                openAdsets={openAdsets}
                roasTarget={roasTarget}
                sortRows={sortRows}
                onToggleCampaign={() => setOpenCampaigns((s) => toggle(s, c.id))}
                onToggleAdset={(id) => setOpenAdsets((s) => toggle(s, id))}
              />
            );
          })}
          {sortedCampaigns.length === 0 ? (
            <tr>
              <td colSpan={COLUMNS.length + 1} className="py-6 text-center text-muted-foreground">
                No Meta delivery in this period.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MetricCells({ m, roasTarget }: { m: MetaMetrics; roasTarget: number }) {
  return (
    <>
      <td className="py-2 pl-4 text-right tabular-nums font-medium">{fmtUsd(m.spend)}</td>
      <td className="py-2 pl-4 text-right tabular-nums">{fmtUsd(m.purchaseValue)}</td>
      <td className={cn("py-2 pl-4 text-right tabular-nums font-semibold", roasClass(m.roas, roasTarget))}>
        {fmtRoas(m.roas)}
      </td>
      <td className="py-2 pl-4 text-right tabular-nums">{fmtInt(m.purchases)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtUsd2(m.cpa)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtUsd2(m.cpm)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtPct(m.ctr)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtPct(m.hookRate)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtPct(m.holdRate)}</td>
      <td className="py-2 pl-4 text-right tabular-nums text-muted-foreground">{fmtRatio(m.frequency)}</td>
    </>
  );
}

function CampaignRows({
  campaign: c,
  open,
  openAdsets,
  roasTarget,
  sortRows,
  onToggleCampaign,
  onToggleAdset,
}: {
  campaign: MetaCampaignNode;
  open: boolean;
  openAdsets: Set<string>;
  roasTarget: number;
  sortRows: <T extends { metrics: MetaMetrics }>(rows: T[]) => T[];
  onToggleCampaign: () => void;
  onToggleAdset: (id: string) => void;
}) {
  const budget = budgetChip(c.dailyBudget, c.lifetimeBudget);
  return (
    <>
      <tr className="border-t border-border/60 hover:bg-muted/40 transition-colors">
        <td className="py-2 pr-4 sticky left-0 bg-card z-10">
          <button onClick={onToggleCampaign} className="flex items-center gap-1.5 text-left w-full">
            <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <StatusDot status={c.effectiveStatus ?? c.status} />
            <span className="font-medium truncate max-w-[300px]">{c.name}</span>
            {budget ? <span className="text-[10px] text-muted-foreground shrink-0">· {budget}</span> : null}
          </button>
        </td>
        <MetricCells m={c.metrics} roasTarget={roasTarget} />
      </tr>

      {open
        ? sortRows(c.adsets).map((as) => (
            <AdsetRows
              key={as.id}
              adset={as}
              open={openAdsets.has(as.id)}
              roasTarget={roasTarget}
              sortRows={sortRows}
              onToggle={() => onToggleAdset(as.id)}
            />
          ))
        : null}
    </>
  );
}

function AdsetRows({
  adset: as,
  open,
  roasTarget,
  sortRows,
  onToggle,
}: {
  adset: MetaAdsetNode;
  open: boolean;
  roasTarget: number;
  sortRows: <T extends { metrics: MetaMetrics }>(rows: T[]) => T[];
  onToggle: () => void;
}) {
  const budget = budgetChip(as.dailyBudget, as.lifetimeBudget);
  return (
    <>
      <tr className="border-t border-border/40 hover:bg-muted/30 transition-colors">
        <td className="py-1.5 pr-4 sticky left-0 bg-card z-10">
          <button onClick={onToggle} className="flex items-center gap-1.5 text-left w-full pl-5">
            <ChevronRight size={13} className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
            <StatusDot status={as.effectiveStatus ?? as.status} />
            <span className="truncate max-w-[280px] text-foreground/90">{as.name}</span>
            {budget ? <span className="text-[10px] text-muted-foreground shrink-0">· {budget}</span> : null}
          </button>
        </td>
        <MetricCells m={as.metrics} roasTarget={roasTarget} />
      </tr>

      {open ? sortRows(as.ads).map((ad) => <AdRow key={ad.id} ad={ad} roasTarget={roasTarget} />) : null}
    </>
  );
}

function AdRow({ ad, roasTarget }: { ad: MetaAdNode; roasTarget: number }) {
  return (
    <tr className="border-t border-border/30 hover:bg-muted/20 transition-colors">
      <td className="py-1.5 pr-4 sticky left-0 bg-card z-10">
        <div className="flex items-center gap-2 pl-10">
          {ad.thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.thumbUrl} alt="" className="size-7 rounded object-cover shrink-0 border border-border/50" />
          ) : (
            <div className="size-7 rounded bg-muted shrink-0" />
          )}
          <StatusDot status={ad.effectiveStatus ?? ad.status} />
          <span className="truncate max-w-[240px] text-foreground/80 text-[13px]">{ad.name}</span>
        </div>
      </td>
      <MetricCells m={ad.metrics} roasTarget={roasTarget} />
    </tr>
  );
}
