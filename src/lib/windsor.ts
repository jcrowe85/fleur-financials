// Thin client for the Windsor.ai connectors API.
// Endpoint pattern: https://connectors.windsor.ai/{connector_slug}
// Note: /all only works for multi-report connectors. Single-report connectors
// like amazon_sp must use the path-style endpoint.
// Field reference: https://windsor.ai/data-field/{connector_slug}/

const BASE_URL = "https://connectors.windsor.ai";

export type WindsorRow = Record<string, string | number | null>;

export interface WindsorFetchParams {
  connector: string;
  fields: string[];
  date_from?: string;
  date_to?: string;
  date_preset?: string;
  account?: string | string[];
  /** Per-request timeout in milliseconds. Default 30s. */
  timeoutMs?: number;
}

export class WindsorError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = "WindsorError";
  }
}

export async function windsorFetch(params: WindsorFetchParams): Promise<WindsorRow[]> {
  const apiKey = process.env.WINDSOR_API_KEY;
  if (!apiKey) {
    throw new WindsorError("WINDSOR_API_KEY is not set");
  }

  const url = new URL(`${BASE_URL}/${encodeURIComponent(params.connector)}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("fields", params.fields.join(","));
  if (params.date_from) url.searchParams.set("date_from", params.date_from);
  if (params.date_to) url.searchParams.set("date_to", params.date_to);
  if (params.date_preset) url.searchParams.set("date_preset", params.date_preset);
  if (params.account) {
    const accounts = Array.isArray(params.account) ? params.account.join(",") : params.account;
    url.searchParams.set("account", accounts);
  }

  const controller = new AbortController();
  const timeoutMs = params.timeoutMs ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  let text: string;
  try {
    res = await fetch(url, { method: "GET", signal: controller.signal });
    text = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WindsorError(`Windsor request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new WindsorError(
      `Windsor request failed: ${res.status} ${res.statusText}`,
      res.status,
      text.slice(0, 500),
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new WindsorError("Windsor returned non-JSON response", res.status, text.slice(0, 500));
  }

  if (typeof payload === "object" && payload !== null && "data" in payload) {
    const data = (payload as { data: unknown }).data;
    if (Array.isArray(data)) return data as WindsorRow[];
  }

  if (Array.isArray(payload)) return payload as WindsorRow[];

  throw new WindsorError(
    "Unexpected Windsor response shape",
    res.status,
    JSON.stringify(payload).slice(0, 500),
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
