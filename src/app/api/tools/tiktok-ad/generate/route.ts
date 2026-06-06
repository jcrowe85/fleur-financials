import { NextResponse } from "next/server";
import { downloadTiktok, generateCopy, transcribe, uploadVideo } from "@/lib/tiktok-ad";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const { url } = (await req.json()) as { url?: string };
  if (!url?.trim()) {
    return NextResponse.json({ ok: false, error: "url is required" }, { status: 400 });
  }

  try {
    // Download TikTok video
    const buf = await downloadTiktok(url.trim());

    // Transcribe (Whisper accepts mp4 directly)
    const transcript = await transcribe(buf);

    // Generate ad copy
    const copy = await generateCopy(transcript);

    // Upload video to Meta and wait until ready
    const adName = `TT-${Date.now()}`;
    const video_id = await uploadVideo(buf, adName);

    return NextResponse.json({ ok: true, video_id, transcript, copy, suggested_name: adName });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
