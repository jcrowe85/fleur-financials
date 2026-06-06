"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, History, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  prefix?: boolean;
}

function MetaBadge() {
  return (
    <span className="inline-flex size-4 items-center justify-center rounded bg-[#0866FF] text-white text-[10px] font-bold shrink-0">
      f
    </span>
  );
}

function TikTokBadge() {
  return (
    <span className="inline-flex size-4 items-center justify-center rounded bg-black text-white text-[9px] font-bold shrink-0 leading-none">
      TT
    </span>
  );
}

const NAV: NavItem[] = [
  { href: "/", label: "Sales", icon: <BarChart3 size={16} /> },
  { href: "/meta", label: "Meta Ads", icon: <MetaBadge />, prefix: true },
  { href: "/admin/syncs", label: "Sync history", icon: <History size={16} />, prefix: true },
];

const TOOLS: NavItem[] = [
  { href: "/tools/tiktok-to-meta", label: "TikTok → Meta", icon: <TikTokBadge />, prefix: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.prefix ? pathname.startsWith(item.href) : pathname === item.href;
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = isActive(pathname, item);
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="shrink-0">{item.icon}</span>
      {item.label}
    </Link>
  );
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}

      <div className="my-1 border-t border-border/60" />

      <p className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        <Wand2 size={10} />
        Tools
      </p>

      {TOOLS.map((item) => (
        <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
      ))}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: fixed left rail */}
      <aside className="hidden md:flex w-52 shrink-0 flex-col gap-1 border-r bg-card sticky top-0 h-screen p-3">
        <div className="flex items-center gap-2 px-2.5 py-2 mb-2">
          <span className="text-lg font-semibold tracking-tight">Fleur</span>
        </div>
        <nav className="flex flex-col gap-1">
          <NavLinks pathname={pathname} />
        </nav>
      </aside>

      {/* Mobile: top bar */}
      <div className="md:hidden sticky top-0 z-30 flex items-center gap-1 border-b bg-card px-3 py-2 overflow-x-auto">
        <span className="text-base font-semibold tracking-tight pr-2">Fleur</span>
        <NavLinks pathname={pathname} />
      </div>
    </>
  );
}
