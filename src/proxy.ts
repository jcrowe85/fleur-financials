import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_COOKIE = "fleur_session";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "fleur-internal-dashboard";

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow login page and session API through
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth/session")) {
    return NextResponse.next();
  }

  // Allow cron sync and metrics routes (authenticated by CRON_SECRET header)
  if (pathname.startsWith("/api/sync") || pathname.startsWith("/api/metrics")) {
    return NextResponse.next();
  }

  const session = req.cookies.get(AUTH_COOKIE)?.value;
  if (session === SESSION_SECRET) {
    return NextResponse.next();
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?from=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
