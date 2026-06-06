"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetaTrendPoint } from "@/lib/meta-metrics";

// Spend vs revenue (bars) with ROAS overlaid as a line on a second axis — the
// canonical "is spend buying revenue?" chart. Styling matches SalesChart.tsx.
const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

export function MetaTrendChart({ data }: { data: MetaTrendPoint[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickFormatter={shortDate}
            minTickGap={24}
          />
          <YAxis
            yAxisId="left"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickFormatter={(v: number) => usdFmt.format(v)}
            width={64}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="var(--muted-foreground)"
            fontSize={12}
            tickFormatter={(v: number) => `${v.toFixed(1)}×`}
            width={44}
          />
          <Tooltip
            formatter={(value, name) => {
              if (name === "ROAS") return [`${Number(value ?? 0).toFixed(2)}×`, "ROAS"];
              return [usdFmt.format(Number(value ?? 0)), name as string];
            }}
            labelFormatter={(label) => (typeof label === "string" ? shortDate(label) : "")}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              fontSize: 12,
            }}
          />
          <Bar yAxisId="left" dataKey="spend" name="Spend" fill="var(--primary)" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="var(--primary)" fillOpacity={0.35} radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="roas" name="ROAS" stroke="#f59e0b" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
