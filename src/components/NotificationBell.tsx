"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, AlertTriangle, Gift, CheckCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface Alert {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  readAt: string | null;
}

// Visual treatment per alert kind. Crashes are red; everything else amber.
function kindMeta(kind: string): { label: string; icon: React.ReactNode; tone: string } {
  switch (kind) {
    case "sweep_crash":
    case "verify_crash":
      return { label: "Crash", icon: <AlertTriangle size={14} />, tone: "text-red-400" };
    case "gift_verify_miss":
      return { label: "Missed gift", icon: <Gift size={14} />, tone: "text-amber-400" };
    case "sweep_errors":
      return { label: "Sweep errors", icon: <AlertTriangle size={14} />, tone: "text-amber-400" };
    default:
      return { label: kind, icon: <AlertTriangle size={14} />, tone: "text-muted-foreground" };
  }
}

const POLL_MS = 60_000;

export function NotificationBell() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { alerts: Alert[]; unreadCount: number };
      setAlerts(data.alerts);
      setUnread(data.unreadCount);
    } catch {
      // network blip — keep last known state, next poll retries
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Refetch on open so the list is fresh the moment it's viewed.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const markAllRead = useCallback(async () => {
    setUnread(0);
    setAlerts((prev) => prev.map((a) => ({ ...a, readAt: a.readAt ?? new Date().toISOString() })));
    try {
      await fetch("/api/alerts/read", { method: "POST" });
    } finally {
      load();
    }
  }, [load]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`Alerts${unread ? ` (${unread} unread)` : ""}`}
        className="relative flex items-center justify-center size-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 h-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent side="right" align="start" sideOffset={8} className="w-80 p-0">
        <PopoverHeader className="flex items-center justify-between border-b px-3 py-2.5">
          <PopoverTitle className="text-sm font-semibold">Gift Engine Alerts</PopoverTitle>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <CheckCheck size={13} /> Mark all read
            </button>
          )}
        </PopoverHeader>

        <div className="max-h-96 overflow-y-auto">
          {alerts.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">No alerts 🎉</p>
          ) : (
            alerts.map((a) => {
              const meta = kindMeta(a.kind);
              const unreadRow = !a.readAt;
              return (
                <div
                  key={a.id}
                  className={cn(
                    "flex gap-2.5 px-3 py-2.5 border-b border-border/50 last:border-0",
                    unreadRow && "bg-muted/40",
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", meta.tone)}>{meta.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-medium", meta.tone)}>{meta.label}</span>
                      {unreadRow && <span className="size-1.5 rounded-full bg-red-500 shrink-0" />}
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                        {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground break-words line-clamp-3">
                      {a.message}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
