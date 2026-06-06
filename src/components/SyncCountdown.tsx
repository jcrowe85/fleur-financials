"use client";

import { useEffect, useState } from "react";

const CRON_INTERVAL_MS = 15 * 60 * 1000;

function msTilNextCron(): number {
  const now = Date.now();
  return CRON_INTERVAL_MS - (now % CRON_INTERVAL_MS);
}

function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SyncCountdown() {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    setMs(msTilNextCron());
    const id = setInterval(() => setMs(msTilNextCron()), 1000);
    return () => clearInterval(id);
  }, []);

  if (ms === null) return null;

  return (
    <span className="text-[11px] text-muted-foreground">
      {" · Next sync in "}
      <span className="tabular-nums">{fmt(ms)}</span>
    </span>
  );
}
