"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMemo } from "react";
import type { DailyByChannelPoint } from "@/lib/metrics";

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m) - 1]} ${Number(d)}`;
}

interface MarketplaceChartProps {
  data: DailyByChannelPoint[];
}

// Distinct hues so US/CA/MX/BR stay visually separable.
const COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"];

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function MarketplaceChart({ data }: MarketplaceChartProps) {
  const { rows, channels } = useMemo(() => {
    const channelSet = new Set<string>();
    const byDate = new Map<string, Record<string, number | string>>();

    for (const point of data) {
      channelSet.add(point.subChannel);
      const row = byDate.get(point.date) ?? { date: point.date };
      row[point.subChannel] = ((row[point.subChannel] as number) ?? 0) + point.grossSales;
      byDate.set(point.date, row);
    }

    const sortedRows = Array.from(byDate.values()).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );

    return { rows: sortedRows, channels: Array.from(channelSet).sort() };
  }, [data]);

  if (channels.length === 0) {
    return (
      <div className="h-72 w-full flex items-center justify-center text-sm text-muted-foreground">
        No marketplace data in this range yet.
      </div>
    );
  }

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickFormatter={shortDate}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickFormatter={(value: number) => currencyFmt.format(value)}
            width={70}
          />
          <Tooltip
            formatter={(value, name) => [currencyFmt.format(Number(value ?? 0)), String(name)]}
            labelFormatter={(label) => (typeof label === "string" ? shortDate(label) : "")}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {channels.map((channel, idx) => (
            <Bar
              key={channel}
              dataKey={channel}
              stackId="sales"
              fill={COLORS[idx % COLORS.length]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
