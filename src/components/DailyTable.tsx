import type { DailyByChannelPoint, DailyPoint } from "@/lib/metrics";

interface DailyTableProps {
  daily: DailyPoint[];
  dailyByChannel: DailyByChannelPoint[];
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const numberFmt = new Intl.NumberFormat("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(iso: string): { day: string; weekday: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return { day: `${MONTHS[m - 1]} ${d}`, weekday };
}

export function DailyTable({ daily, dailyByChannel }: DailyTableProps) {
  const subChannels = Array.from(new Set(dailyByChannel.map((p) => p.subChannel))).sort();
  const byDate = new Map<string, Map<string, number>>();
  for (const p of dailyByChannel) {
    const row = byDate.get(p.date) ?? new Map<string, number>();
    row.set(p.subChannel, (row.get(p.subChannel) ?? 0) + p.grossSales);
    byDate.set(p.date, row);
  }

  const rows = [...daily].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b">
            <th className="text-left font-medium py-2 pr-4">Date</th>
            <th className="text-right font-medium py-2 pr-4">Sales</th>
            <th className="text-right font-medium py-2 pr-4">Units</th>
            <th className="text-right font-medium py-2 pr-4">Orders</th>
            <th className="text-right font-medium py-2 pr-4">AOV</th>
            {subChannels.map((sc) => (
              <th key={sc} className="text-right font-medium py-2 pr-4">
                {sc}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { day, weekday } = dateLabel(row.date);
            const aov = row.orders > 0 ? row.grossSales / row.orders : null;
            const channelTotals = byDate.get(row.date) ?? new Map();
            return (
              <tr key={row.date} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                <td className="py-2 pr-4">
                  <div className="font-medium">{day}</div>
                  <div className="text-[11px] text-muted-foreground">{weekday}</div>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-medium">
                  {currencyFmt.format(row.grossSales)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {numberFmt.format(row.units)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {numberFmt.format(row.orders)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                  {aov !== null ? currencyFmt.format(aov) : "—"}
                </td>
                {subChannels.map((sc) => (
                  <td key={sc} className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                    {currencyFmt.format(channelTotals.get(sc) ?? 0)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
