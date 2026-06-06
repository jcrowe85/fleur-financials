import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const shop = url.searchParams.get("shop");

  if (!code || !shop) {
    return new NextResponse("Missing code or shop", { status: 400 });
  }

  const clientId = process.env.SHOPIFY_PARTNER_CLIENT_ID!;
  const clientSecret = process.env.SHOPIFY_PARTNER_CLIENT_SECRET!;

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });

  const json = (await res.json()) as { access_token?: string; error?: string };

  if (!json.access_token) {
    return new NextResponse(`Token exchange failed: ${JSON.stringify(json)}`, { status: 500 });
  }

  return new NextResponse(
    `<html><body style="font-family:monospace;padding:2rem">
      <h2>✅ Access token obtained</h2>
      <p>Add this to your <code>.env.local</code> as <code>SHOPIFY_PARTNER_ACCESS_TOKEN</code>:</p>
      <pre style="background:#f0f0f0;padding:1rem;word-break:break-all">${json.access_token}</pre>
    </body></html>`,
    { headers: { "Content-Type": "text/html" } },
  );
}
