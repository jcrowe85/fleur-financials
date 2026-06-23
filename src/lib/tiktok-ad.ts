import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegPath: string = require("ffmpeg-static");

const execFileAsync = promisify(execFile);

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

// ── 2. Transcribe — extract audio first (mono 16kHz mp3 ≈ 500 KB/min) ────────

export async function transcribe(videoBuf: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tiktok-"));
  const videoPath = join(dir, "video.mp4");
  const audioPath = join(dir, "audio.mp3");
  try {
    await writeFile(videoPath, videoBuf);
    await execFileAsync(ffmpegPath, [
      "-y", "-i", videoPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k",
      audioPath,
    ]);
    const audioBuf = await readFile(audioPath);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(audioBuf)], { type: "audio/mpeg" }), "audio.mp3");
    form.append("model", "whisper-1");
    form.append("response_format", "json");
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${req("OPENAI_API_KEY")}` },
      body: form,
    });
    if (!r.ok) throw new Error(`Whisper ${r.status}: ${await r.text().then((t) => t.slice(0, 300))}`);
    return ((await r.json()) as { text?: string }).text?.trim() ?? "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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

// Meta requires a thumbnail (image_hash or image_url) in video_data. It auto-
// generates thumbnails once the video is processed — fetch the preferred one.
async function getVideoThumbnail(videoId: string, retries = 5): Promise<string> {
  const token = req("META_ACCESS_TOKEN");
  for (let attempt = 0; attempt < retries; attempt++) {
    const r = await fetch(
      `${GRAPH}/${videoId}/thumbnails?fields=uri,is_preferred&access_token=${token}`,
    );
    if (r.ok) {
      const d = (await r.json()) as { data?: { uri: string; is_preferred?: boolean }[] };
      const thumbs = d.data ?? [];
      const chosen = thumbs.find((t) => t.is_preferred) ?? thumbs[0];
      if (chosen?.uri) return chosen.uri;
    }
    // Thumbnails can lag slightly behind "ready" status — back off and retry.
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`No thumbnail available for video ${videoId} after ${retries} attempts`);
}

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
    image_url: await getVideoThumbnail(opts.video_id),
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
    throw new Error(`Creative create — ${metaErrorMessage(r.status, await r.text())}`);
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
    throw new Error(`Ad create — ${metaErrorMessage(r.status, await r.text())}`);
  return ((await r.json()) as { id: string }).id;
}

// ── 6b. Clone a reference ad set within a campaign for the new ad ──────────────
// We never drop the ad into an existing ad set. Instead we duplicate one of the
// campaign's ad sets (without its ads) so the new ad lands in a fresh ad set that
// inherits the reference's targeting, budget, and optimization settings.

export async function cloneAdsetForCampaign(opts: {
  campaign_id: string;
  name: string;
  /** Daily budget in dollars to set on the clone (overrides the reference's budget). */
  daily_budget_dollars?: number;
}): Promise<string> {
  const token = req("META_ACCESS_TOKEN");

  // Pick a reference ad set in the chosen campaign — prefer an active one.
  // Query just this campaign's ad sets (one call) rather than the whole account.
  const inCampaign = await listCampaignAdsets(opts.campaign_id);
  if (inCampaign.length === 0)
    throw new Error(
      "This campaign has no ad set to use as a template. Create at least one ad set in it first.",
    );
  const reference = inCampaign.find((a) => a.effective_status === "ACTIVE") ?? inCampaign[0];

  // Duplicate it without its ads (deep_copy=false) so we get an empty ad set.
  const copyRes = await fetch(`${GRAPH}/${reference.id}/copies`, {
    method: "POST",
    body: new URLSearchParams({
      deep_copy: "false",
      status_option: "ACTIVE",
      access_token: token,
    }),
  });
  if (!copyRes.ok)
    throw new Error(`Ad set copy — ${metaErrorMessage(copyRes.status, await copyRes.text())}`);
  const copied = (await copyRes.json()) as { copied_adset_id?: string };
  if (!copied.copied_adset_id)
    throw new Error(`Ad set copy returned no id: ${JSON.stringify(copied)}`);
  const newAdsetId = copied.copied_adset_id;

  // Rename the copy so it's identifiable, and override its daily budget.
  // The clone inherits the reference's budget (which may have been scaled up),
  // so we reset it to the requested amount. Only applies to ad-set-level (ABO)
  // budgets — CBO ad sets have no daily_budget (budget lives on the campaign),
  // and trying to set one would be rejected.
  const updateParams = new URLSearchParams({ name: opts.name, access_token: token });
  if (opts.daily_budget_dollars != null && reference.daily_budget) {
    updateParams.set("daily_budget", String(Math.round(opts.daily_budget_dollars * 100)));
  }
  const updateRes = await fetch(`${GRAPH}/${newAdsetId}`, {
    method: "POST",
    body: updateParams,
  });
  if (!updateRes.ok)
    throw new Error(`Ad set update — ${metaErrorMessage(updateRes.status, await updateRes.text())}`);

  return newAdsetId;
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
  /** Ad-set-level daily budget in minor units (cents). Empty for CBO ad sets. */
  daily_budget: string;
}

// Turn a Meta error body into a human-readable message. Rate-limit codes
// (4 app-level, 17 user-level, 32 page-level, 613 custom) get a clear hint that
// the ad account's API budget is exhausted and resets within ~1 hour.
export function metaErrorMessage(status: number, body: string): string {
  try {
    const e = (JSON.parse(body) as {
      error?: { code?: number; error_user_title?: string; error_user_msg?: string; message?: string };
    }).error;
    if (e) {
      if ([4, 17, 32, 613].includes(e.code ?? 0)) {
        const detail = e.error_user_msg ?? e.message ?? "";
        return `Meta rate limit reached — the ad account has made too many API calls. This resets within about an hour; wait a few minutes and try again. ${detail}`.trim();
      }
      if (e.error_user_title) return `${e.error_user_title}: ${e.error_user_msg ?? e.message ?? ""}`.trim();
      if (e.message) return e.message;
    }
  } catch {
    // fall through to raw
  }
  return `Meta API ${status}: ${body.slice(0, 200)}`;
}

async function fetchAllPages<T>(initialUrl: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = initialUrl;
  while (url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(metaErrorMessage(r.status, await r.text()));
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

interface RawAdset {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  daily_budget?: string;
  campaign?: { id: string; name: string };
}

const ADSET_FIELDS = "id,name,status,effective_status,daily_budget,campaign{id,name}";

function mapAdsets(raw: RawAdset[]): MetaAdset[] {
  return raw
    .map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      effective_status: a.effective_status,
      campaign_id: a.campaign?.id ?? "",
      campaign_name: a.campaign?.name ?? "",
      daily_budget: a.daily_budget ?? "",
    }))
    .sort((a, b) => a.campaign_name.localeCompare(b.campaign_name) || a.name.localeCompare(b.name));
}

export async function listAdsets(): Promise<MetaAdset[]> {
  const token = req("META_ACCESS_TOKEN");
  const acct = req("META_AD_ACCOUNT_ID");
  const url =
    `${GRAPH}/act_${acct}/adsets?` +
    new URLSearchParams({ fields: ADSET_FIELDS, limit: "200", access_token: token });
  return mapAdsets(await fetchAllPages<RawAdset>(url));
}

// Just the ad sets in one campaign — a single edge query instead of paging the
// whole account's ad sets. Keeps the launcher's Meta API footprint small.
export async function listCampaignAdsets(campaignId: string): Promise<MetaAdset[]> {
  const token = req("META_ACCESS_TOKEN");
  const url =
    `${GRAPH}/${campaignId}/adsets?` +
    new URLSearchParams({ fields: ADSET_FIELDS, limit: "200", access_token: token });
  return mapAdsets(await fetchAllPages<RawAdset>(url));
}

export function adsManagerUrl(adId: string): string {
  const acct = process.env.META_AD_ACCOUNT_ID ?? "";
  return `https://adsmanager.facebook.com/adsmanager/manage/ads?act=${acct}&selected_ad_ids=${adId}`;
}
