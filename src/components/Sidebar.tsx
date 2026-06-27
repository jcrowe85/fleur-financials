"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, ExternalLink, Gift, History, Menu, Wand2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { NotificationBell } from "@/components/NotificationBell";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  prefix?: boolean;
  external?: boolean;
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
  { href: "https://fleur-gift-engine.vercel.app/login", label: "Gift Engine", icon: <Gift size={16} />, external: true },
];

function isActive(pathname: string, item: NavItem): boolean {
  return item.prefix ? pathname.startsWith(item.href) : pathname === item.href;
}

function NavLink({ item, pathname, onNavigate }: { item: NavItem; pathname: string; onNavigate?: () => void }) {
  const active = !item.external && isActive(pathname, item);
  const className = cn(
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
    active
      ? "bg-muted text-foreground"
      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
  );

  if (item.external) {
    return (
      <a
        href={item.href}
        onClick={onNavigate}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        <span className="shrink-0">{item.icon}</span>
        {item.label}
        <ExternalLink size={12} className="ml-auto shrink-0 text-muted-foreground/50" />
      </a>
    );
  }

  return (
    <Link href={item.href} onClick={onNavigate} className={className}>
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

      <div className="my-2 border-t border-border/60" />

      <p className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
        <Wand2 size={10} />
        Tools
      </p>

      {TOOLS.map((item) =>
        item.external && item.href.includes("fleur-gift-engine") ? (
          // Gift Engine link carries the alert bell beside it.
          <div key={item.href} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <NavLink item={item} pathname={pathname} onNavigate={onNavigate} />
            </div>
            <NotificationBell />
          </div>
        ) : (
          <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
        ),
      )}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* ── Desktop: fixed left rail ── */}
      <aside className="hidden md:flex w-52 shrink-0 flex-col gap-1 border-r bg-card sticky top-0 h-screen p-3">
        <div className="flex items-center gap-2 px-3 py-2 mb-2">
          <span className="text-lg font-semibold tracking-tight">Fleur</span>
        </div>
        <nav className="flex flex-col gap-0.5">
          <NavLinks pathname={pathname} />
        </nav>
      </aside>

      {/* ── Mobile: slim top bar ── */}
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between border-b bg-card/95 backdrop-blur-sm px-4 h-12">
        <span className="text-base font-semibold tracking-tight">Fleur</span>
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex items-center justify-center size-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Menu size={20} />
        </button>
      </header>

      {/* ── Mobile drawer ── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Drawer panel */}
          <div className="fixed inset-y-0 left-0 z-50 w-72 bg-card border-r flex flex-col md:hidden">
            <div className="flex items-center justify-between px-4 h-12 border-b shrink-0">
              <span className="text-base font-semibold tracking-tight">Fleur</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="flex items-center justify-center size-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5 p-3 overflow-y-auto flex-1">
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
            </nav>
          </div>
        </>
      )}
    </>
  );
}
