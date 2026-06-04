import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const AUTH_COOKIE = "fleur_session";
const SESSION_SECRET = process.env.SESSION_SECRET ?? "fleur-internal-dashboard";

const VALID_EMAIL = process.env.AUTH_EMAIL ?? "team@tryfleur.com";
const VALID_PASSWORD = process.env.AUTH_PASSWORD ?? "Tryfleur123!";

export async function POST(req: Request) {
  const { email, password } = await req.json() as { email?: string; password?: string };

  if (email !== VALID_EMAIL || password !== VALID_PASSWORD) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE, SESSION_SECRET, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_COOKIE);
  return NextResponse.json({ ok: true });
}
