import { NextResponse } from "next/server";
import { adsManagerUrl, createAd, createCreative } from "@/lib/tiktok-ad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface PublishBody {
  video_id: string;
  adset_id: string;
  ad_name: string;
  primary_text: string;
  headline: string;
  description?: string;
  destination_url: string;
  cta_type?: string;
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<PublishBody>;

  if (!body.video_id || !body.adset_id || !body.ad_name || !body.destination_url) {
    return NextResponse.json(
      { ok: false, error: "video_id, adset_id, ad_name, and destination_url are required" },
      { status: 400 },
    );
  }

  try {
    const creative_id = await createCreative({
      name: `${body.ad_name} creative`,
      video_id: body.video_id,
      primary_text: body.primary_text ?? "",
      headline: body.headline ?? "",
      description: body.description,
      destination_url: body.destination_url,
      cta_type: body.cta_type ?? "SHOP_NOW",
    });

    const ad_id = await createAd({
      adset_id: body.adset_id,
      creative_id,
      name: body.ad_name,
    });

    return NextResponse.json({ ok: true, ad_id, url: adsManagerUrl(ad_id) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
