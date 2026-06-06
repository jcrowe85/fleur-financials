import Anthropic from "@anthropic-ai/sdk";

const GRAPH = "https://graph.facebook.com/v20.0";
const RAPID_HOST =
  process.env.RAPIDAPI_TIKTOK_HOST ?? "tiktok-video-no-watermark2.p.rapidapi.com";

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// ── 1. Download TikTok ────────────────────────────────────────────────────────

export async function downloadTiktok(url: string): Promise<Buffer> {
  const r = await fetch(
    `https://${RAPID_HOST}/?` + new URLSearchParams({ url, hd: "1" }),
    { headers: { "X-RapidAPI-Key": req("RAPIDAPI_KEY"), "X-RapidAPI-Host": RAPID_HOST } },
  );
  if (!r.ok) throw new Error(`RapidAPI ${r.status}: ${await r.text().then((t) => t.slice(0, 200))}`);
  const json = (await r.json()) as { code?: number; msg?: string; data?: Record<string, string> };
  if (json.code !== 0 && json.code !== undefined)
    throw new Error(`RapidAPI error: ${json.msg ?? JSON.stringify(json)}`);
  const data = json.data ?? {};
  const playUrl = data.hdplay ?? data.play ?? data.wmplay;
  if (!playUrl) throw new Error("No play URL in RapidAPI response");

  const vr = await fetch(playUrl);
  if (!vr.ok) throw new Error(`Video download failed: ${vr.status}`);
  return Buffer.from(await vr.arrayBuffer());
}

// ── 2. Transcribe (send mp4 directly — Whisper accepts video) ─────────────────

export async function transcribe(buf: Buffer): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buf)], { type: "video/mp4" }), "video.mp4");
  form.append("model", "whisper-1");
  form.append("response_format", "json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${req("OPENAI_API_KEY")}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text().then((t) => t.slice(0, 300))}`);
  return ((await r.json()) as { text?: string }).text?.trim() ?? "";
}

// ── 3. Generate ad copy ───────────────────────────────────────────────────────

const COPY_SYSTEM =
  "You write Facebook/Instagram ad copy for a direct-response brand. " +
  "Given a transcript of a TikTok video, produce ad copy that matches the " +
  "voice and hook of the video while being optimized for Meta Ads. " +
  "Constraints: primary_text <= 125 chars (no emojis unless the transcript used them), " +
  "headline <= 40 chars, description <= 30 chars. " +
  "If the transcript is empty or non-verbal, infer reasonable copy from the brand context " +
  "(haircare / scalp serum) and note 'visual-only' in the description. " +
  "Reply with ONLY a JSON object, no prose, with keys: primary_text, headline, description.";

export interface AdCopy {
  primary_text: string;
  headline: string;
  description: string;
}

export async function generateCopy(transcript: string): Promise<AdCopy> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    system: COPY_SYSTEM,
    messages: [{ role: "user", content: `Transcript:\n\n${transcript || "(no speech detected)"}` }],
  });
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`Claude did not return JSON: ${text.slice(0, 200)}`);
  const obj = JSON.parse(m[0]) as Partial<AdCopy>;
  return {
    primary_text: String(obj.primary_text ?? "").trim(),
    headline: String(obj.headline ?? "").trim(),
    description: String(obj.description ?? "").trim(),
  };
}

// ── 4. Upload video to Meta (chunked 3-phase) ─────────────────────────────────

export async function uploadVideo(buf: Buffer, name: string): Promise<string> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");
  const url = `${GRAPH}/act_${acct}/advideos`;

  // Phase 1: start
  const startRes = await fetch(url, {
    method: "POST",
    body: new URLSearchParams({
      upload_phase: "start",
      file_size: String(buf.length),
      access_token: token,
    }),
  });
  if (!startRes.ok)
    throw new Error(`Video upload start failed ${startRes.status}: ${await startRes.text().then((t) => t.slice(0, 300))}`);
  const start = (await startRes.json()) as {
    upload_session_id: string;
    video_id: string;
    start_offset: string;
    end_offset: string;
  };
  const { upload_session_id, video_id } = start;
  let startOffset = Number(start.start_offset);
  let endOffset = Number(start.end_offset);

  // Phase 2: transfer chunks
  while (startOffset < endOffset) {
    const chunk = buf.slice(startOffset, endOffset);
    const form = new FormData();
    form.append("upload_phase", "transfer");
    form.append("upload_session_id", upload_session_id);
    form.append("start_offset", String(startOffset));
    form.append("access_token", token);
    form.append(
      "video_file_chunk",
      new Blob([new Uint8Array(chunk)], { type: "application/octet-stream" }),
      "chunk",
    );
    const tr = await fetch(url, { method: "POST", body: form });
    if (!tr.ok)
      throw new Error(`Video transfer failed ${tr.status}: ${await tr.text().then((t) => t.slice(0, 300))}`);
    const d = (await tr.json()) as { start_offset: string; end_offset: string };
    startOffset = Number(d.start_offset);
    endOffset = Number(d.end_offset);
  }

  // Phase 3: finish
  const finRes = await fetch(url, {
    method: "POST",
    body: new URLSearchParams({
      upload_phase: "finish",
      upload_session_id,
      title: name,
      access_token: token,
    }),
  });
  if (!finRes.ok)
    throw new Error(`Video finish failed ${finRes.status}: ${await finRes.text().then((t) => t.slice(0, 300))}`);
  const fin = (await finRes.json()) as { success?: boolean };
  if (!fin.success)
    throw new Error(`Video finish returned non-success: ${JSON.stringify(fin)}`);

  await waitVideoReady(video_id);
  return video_id;
}

async function waitVideoReady(videoId: string, timeoutMs = 180_000): Promise<void> {
  const token = req("META_ACCESS_TOKEN");
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const r = await fetch(
      `${GRAPH}/${videoId}?fields=status&access_token=${token}`,
    );
    if (r.ok) {
      const d = (await r.json()) as { status?: { video_status?: string } };
      const vs = d.status?.video_status ?? "";
      last = vs || last;
      if (vs === "ready") return;
      if (vs === "error") throw new Error(`Video processing failed: ${JSON.stringify(d.status)}`);
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error(`Video not ready within ${timeoutMs / 1000}s (last status: ${last})`);
}

// ── 5. Create creative ────────────────────────────────────────────────────────

export async function createCreative(opts: {
  name: string;
  video_id: string;
  primary_text: string;
  headline: string;
  description?: string;
  destination_url: string;
  cta_type?: string;
}): Promise<string> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");
  const pageId = req("META_PAGE_ID");

  const videoData: Record<string, unknown> = {
    video_id: opts.video_id,
    title: opts.headline,
    message: opts.primary_text,
    call_to_action: {
      type: opts.cta_type ?? "SHOP_NOW",
      value: { link: opts.destination_url },
    },
  };
  if (opts.description) videoData.link_description = opts.description;

  const r = await fetch(`${GRAPH}/act_${acct}/adcreatives`, {
    method: "POST",
    body: new URLSearchParams({
      name: opts.name,
      object_story_spec: JSON.stringify({ page_id: pageId, video_data: videoData }),
      access_token: token,
    }),
  });
  if (!r.ok)
    throw new Error(`Creative create failed ${r.status}: ${await r.text().then((t) => t.slice(0, 400))}`);
  return ((await r.json()) as { id: string }).id;
}

// ── 6. Create ad ──────────────────────────────────────────────────────────────

export async function createAd(opts: {
  adset_id: string;
  creative_id: string;
  name: string;
}): Promise<string> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");

  const r = await fetch(`${GRAPH}/act_${acct}/ads`, {
    method: "POST",
    body: new URLSearchParams({
      name: opts.name,
      adset_id: opts.adset_id,
      creative: JSON.stringify({ creative_id: opts.creative_id }),
      status: "ACTIVE",
      access_token: token,
    }),
  });
  if (!r.ok)
    throw new Error(`Ad create failed ${r.status}: ${await r.text().then((t) => t.slice(0, 400))}`);
  return ((await r.json()) as { id: string }).id;
}

// ── 7. List campaigns / ad sets ───────────────────────────────────────────────

export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
}

export interface MetaAdset {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
  campaign_name: string;
}

async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Meta API ${r.status}: ${await r.text().then((t) => t.slice(0, 200))}`);
    const json = (await r.json()) as { data?: T[]; paging?: { next?: string } };
    if (json.data) out.push(...json.data);
    url = json.paging?.next ?? null;
  }
  return out;
}

export async function listCampaigns(): Promise<MetaCampaign[]> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");
  const url =
    `${GRAPH}/act_${acct}/campaigns?` +
    new URLSearchParams({
      fields: "id,name,status,effective_status",
      limit: "200",
      access_token: token,
    });
  const rows = await fetchAllPages<MetaCampaign>(url);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAdsets(): Promise<MetaAdset[]> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");
  const url =
    `${GRAPH}/act_${acct}/adsets?` +
    new URLSearchParams({
      fields: "id,name,status,effective_status,campaign{id,name}",
      limit: "200",
      access_token: token,
    });
  const raw = await fetchAllPages<{
    id: string;
    name: string;
    status: string;
    effective_status: string;
    campaign?: { id: string; name: string };
  }>(url);
  const rows = raw.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    effective_status: a.effective_status,
    campaign_id: a.campaign?.id ?? "",
    campaign_name: a.campaign?.name ?? "",
  }));
  return rows.sort((a, b) =>
    a.campaign_name.localeCompare(b.campaign_name) || a.name.localeCompare(b.name),
  );
}

export function adsManagerUrl(adId: string): string {
  const acct = process.env.META_AD_ACCOUNT_ID ?? "";
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}&selected_ad_ids=${adId}`;
}
