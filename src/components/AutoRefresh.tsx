"use client";

import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function AutoRefresh() {
  const router = useRouter();

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  useEffect(() => {
    const id = setInterval(refresh, REFRESH_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return null;
}
