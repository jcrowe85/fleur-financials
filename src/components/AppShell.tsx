"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

// App chrome: left sidebar (desktop) / top bar (mobile) around every page.
// The login route renders bare — no nav before the user is authenticated.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/login")) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
