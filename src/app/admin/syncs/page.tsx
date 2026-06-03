import { formatInTimeZone } from "date-fns-tz";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  partial: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-300 animate-pulse",
  error: "bg-destructive/15 text-destructive",
};

function fmt(date: Date | null): string {
  return date ? formatInTimeZone(date, "UTC", "yyyy-MM-dd HH:mm:ss 'UTC'") : "—";
}

function duration(start: Date, end: Date | null): string {
  if (!end) return "—";
  const ms = end.getTime() - start.getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${m}m ${rs}s`;
}

export default async function SyncsPage() {
  const logs = await db.syncLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-6">
        <header className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Sync history</h1>
            <p className="text-sm text-muted-foreground">Last 50 runs across all sources.</p>
          </div>
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to dashboard
          </Link>
        </header>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent syncs</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sync runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground border-b">
                    <tr>
                      <th className="text-left font-medium py-2 pr-4">Source</th>
                      <th className="text-left font-medium py-2 pr-4">Status</th>
                      <th className="text-right font-medium py-2 pr-4">Rows</th>
                      <th className="text-left font-medium py-2 pr-4">Started</th>
                      <th className="text-right font-medium py-2 pr-4">Duration</th>
                      <th className="text-left font-medium py-2">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono text-xs">{log.source}</td>
                        <td className="py-2 pr-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              STATUS_STYLES[log.status] ?? "bg-muted text-muted-foreground"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {log.recordsUpserted}
                        </td>
                        <td className="py-2 pr-4 font-mono text-xs">{fmt(log.startedAt)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {duration(log.startedAt, log.finishedAt)}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground max-w-md truncate">
                          {log.errorMessage ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
