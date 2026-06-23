"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdCopy, MetaCampaign } from "@/lib/tiktok-ad";

const CTA_OPTIONS = [
  "SHOP_NOW", "LEARN_MORE", "SIGN_UP", "SUBSCRIBE", "GET_OFFER",
  "ORDER_NOW", "BOOK_TRAVEL", "WATCH_MORE",
];

type Phase = "idle" | "generating" | "ready" | "publishing" | "done" | "error";

interface GenerateResult {
  video_id: string;
  transcript: string;
  copy: AdCopy;
  suggested_name: string;
}

function CharCount({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return (
    <span className={`text-[10px] tabular-nums ${over ? "text-destructive" : "text-muted-foreground"}`}>
      {value.length}/{max}
    </span>
  );
}

export default function TiktokToMetaPage() {
  const [tiktokUrl, setTiktokUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState<GenerateResult | null>(null);

  // Editable copy
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");

  // Ad setup
  const [adName, setAdName] = useState("");
  const [cta, setCta] = useState("SHOP_NOW");
  const [destUrl, setDestUrl] = useState("");
  const [dailyBudget, setDailyBudget] = useState("20");
  const [campaignId, setCampaignId] = useState("");
  const [campaigns, setCampaigns] = useState<MetaCampaign[]>([]);
  const [campaignsLoaded, setCampaignsLoaded] = useState(false);
  const [campaignsError, setCampaignsError] = useState("");

  // Publish result
  const [adUrl, setAdUrl] = useState("");

  const urlRef = useRef<HTMLInputElement>(null);

  // Load campaigns when we enter the ready phase
  useEffect(() => {
    if (phase !== "ready" || campaignsLoaded) return;
    fetch("/api/tools/tiktok-ad/campaigns")
      .then((r) => r.json())
      .then((c) => {
        if (c.ok) setCampaigns(c.campaigns);
        else setCampaignsError(c.error ?? "Failed to load campaigns");
      })
      .catch((e) => setCampaignsError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCampaignsLoaded(true));
  }, [phase, campaignsLoaded]);

  // Only active campaigns are valid targets for a new ad.
  const activeCampaigns = campaigns.filter((c) => c.effective_status === "ACTIVE");

  async function handleGenerate() {
    if (!tiktokUrl.trim()) return;
    setPhase("generating");
    setError("");
    setResult(null);
    try {
      const r = await fetch("/api/tools/tiktok-ad/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: tiktokUrl.trim() }),
      });
      const json = (await r.json()) as GenerateResult & { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Unknown error");
      setResult(json);
      setPrimaryText(json.copy.primary_text);
      setHeadline(json.copy.headline);
      setDescription(json.copy.description);
      setAdName(json.suggested_name);
      setPhase("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function handlePublish() {
    if (!result || !campaignId || !destUrl.trim()) return;
    setPhase("publishing");
    setError("");
    try {
      const r = await fetch("/api/tools/tiktok-ad/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_id: result.video_id,
          campaign_id: campaignId,
          ad_name: adName,
          primary_text: primaryText,
          headline,
          description,
          destination_url: destUrl,
          cta_type: cta,
          daily_budget: Number(dailyBudget) || 20,
        }),
      });
      const json = (await r.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Unknown error");
      setAdUrl(json.url ?? "");
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  function reset() {
    setTiktokUrl("");
    setPhase("idle");
    setError("");
    setResult(null);
    setAdUrl("");
    setCampaignsLoaded(false);
    setCampaignsError("");
    setTimeout(() => urlRef.current?.focus(), 50);
  }

  const isGenerating = phase === "generating";
  const isPublishing = phase === "publishing";
  const busy = isGenerating || isPublishing;

  return (
    <div className="mx-auto max-w-3xl px-6 py-6 space-y-6">
      <header className="border-b pb-4">
        <h1 className="text-xl font-semibold tracking-tight">TikTok → Meta Ad</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Paste a TikTok URL — we download, transcribe, write copy, and launch the ad.
        </p>
      </header>

      {/* ── Step 1: URL input ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">1. TikTok source</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={urlRef}
            type="url"
            value={tiktokUrl}
            onChange={(e) => setTiktokUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && handleGenerate()}
            placeholder="https://www.tiktok.com/@..."
            disabled={busy || phase === "ready" || phase === "done"}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              disabled={!tiktokUrl.trim() || busy || phase === "ready" || phase === "done"}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              {isGenerating ? "Analyzing… (up to 2 min)" : "Analyze video"}
            </button>
            {phase !== "idle" && (
              <button
                onClick={reset}
                disabled={busy}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-40"
              >
                Reset
              </button>
            )}
          </div>
          {isGenerating && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Downloading → transcribing → writing copy → uploading to Meta…
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Step 2: Generated copy ── */}
      {(phase === "ready" || phase === "publishing" || phase === "done") && result && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">2. Ad copy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.transcript && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">Transcript</summary>
                <p className="mt-2 pl-2 border-l leading-relaxed">{result.transcript}</p>
              </details>
            )}

            <div className="space-y-1">
              <div className="flex justify-between items-baseline">
                <label className="text-xs font-medium">Primary text</label>
                <CharCount value={primaryText} max={125} />
              </div>
              <textarea
                value={primaryText}
                onChange={(e) => setPrimaryText(e.target.value)}
                disabled={isPublishing || phase === "done"}
                rows={3}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <label className="text-xs font-medium">Headline</label>
                  <CharCount value={headline} max={40} />
                </div>
                <input
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between items-baseline">
                  <label className="text-xs font-medium">Description</label>
                  <CharCount value={description} max={30} />
                </div>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Ad setup ── */}
      {(phase === "ready" || phase === "publishing" || phase === "done") && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">3. Ad setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Ad name</label>
                <input
                  value={adName}
                  onChange={(e) => setAdName(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Daily budget ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={dailyBudget}
                  onChange={(e) => setDailyBudget(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Call to action</label>
                <select
                  value={cta}
                  onChange={(e) => setCta(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  {CTA_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Destination URL</label>
                <input
                  type="url"
                  value={destUrl}
                  onChange={(e) => setDestUrl(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  placeholder="https://..."
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Campaign</label>
              {!campaignsLoaded ? (
                <p className="text-xs text-muted-foreground animate-pulse">Loading campaigns…</p>
              ) : campaignsError ? (
                <p className="text-xs text-destructive font-mono">
                  Couldn’t load campaigns: {campaignsError}
                </p>
              ) : (
                <select
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                  disabled={isPublishing || phase === "done"}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                >
                  <option value="">— Select a campaign —</option>
                  {activeCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="text-[10px] text-muted-foreground">
                A new ad set will be cloned from an existing one in this campaign to hold the ad.
              </p>
            </div>

            {phase !== "done" && (
              <button
                onClick={handlePublish}
                disabled={!campaignId || !destUrl.trim() || isPublishing}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {isPublishing ? "Launching ad…" : "Launch ad"}
              </button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Done ── */}
      {phase === "done" && adUrl && (
        <Card className="border-emerald-500/40 bg-emerald-500/5">
          <CardContent className="py-4 text-sm">
            <p className="font-medium text-emerald-600 dark:text-emerald-400">Ad launched successfully</p>
            <a
              href={adUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block text-xs text-muted-foreground underline hover:text-foreground"
            >
              View in Ads Manager →
            </a>
          </CardContent>
        </Card>
      )}

      {/* ── Error ── */}
      {phase === "error" && error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">
            <p className="font-medium text-destructive">Error</p>
            <p className="mt-1 text-xs text-muted-foreground font-mono">{error}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
