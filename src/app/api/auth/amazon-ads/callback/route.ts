import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return new NextResponse("Missing code", { status: 400 });

  const clientId = process.env.AMAZON_ADS_CLIENT_ID!;
  const clientSecret = process.env.AMAZON_ADS_CLIENT_SECRET!;

  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: "http://localhost:3000/api/auth/amazon-ads/callback",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const json = (await res.json()) as { access_token?: string; refresh_token?: string; error?: string };

  if (!json.refresh_token) {
    return new NextResponse(`Token exchange failed: ${JSON.stringify(json)}`, { status: 500 });
  }

  return new NextResponse(
    `<html><body style="font-family:monospace;padding:2rem">
      <h2>✅ Amazon Ads token obtained</h2>
      <p>Add to <code>.env.local</code> as <code>AMAZON_ADS_REFRESH_TOKEN</code>:</p>
      <pre style="background:#f0f0f0;padding:1rem;word-break:break-all">${json.refresh_token}</pre>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
