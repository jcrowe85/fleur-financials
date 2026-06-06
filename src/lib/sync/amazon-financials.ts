import crypto from "crypto";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

const SP_API_HOST = "sellingpartnerapi-na.amazon.com";
const SP_API_REGION = "us-east-1";
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getLwaAccessToken(): Promise<string> {
  const res = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMAZON_REFRESH_KEY!,
      client_id: process.env.AMAZON_APP_CLIENT_ID!,
      client_secret: process.env.AMAZON_APP_SECRET!,
    }),
  });
  const json = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`LWA: ${json.error ?? res.status}`);
  return json.access_token;
}

// ─── AWS Sig V4 ───────────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}
function sha256Hex(data: string): string {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function signedGet(path: string, params: Record<string, string>, token: string) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const dateStamp = amzDate.slice(0, 8);
  const qs = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  const canonHeaders = `host:${SP_API_HOST}\nx-amz-access-token:${token}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-access-token;x-amz-date";
  const cr = ["GET", path, qs, canonHeaders, signedHeaders, sha256Hex("")].join("\n");
  const scope = `${dateStamp}/${SP_API_REGION}/execute-api/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(cr)].join("\n");
  const k1 = hmacSha256("AWS4" + process.env.AWS_SECRET_ACCESS_KEY!, dateStamp);
  const k2 = hmacSha256(k1, SP_API_REGION);
  const k3 = hmacSha256(k2, "execute-api");
  const k4 = hmacSha256(k3, "aws4_request");
  const sig = hmacSha256(k4, sts).toString("hex");
  const auth = `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID!}/${scope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;
  return {
    url: `https://${SP_API_HOST}${path}?${qs}`,
    headers: { Authorization: auth, "x-amz-access-token": token, "x-amz-date": amzDate },
  };
}

// ─── Financial Events ─────────────────────────────────────────────────────────

interface FinancialEvents {
  ShipmentEventList?: ShipmentEvent[];
  AdjustmentEventList?: AdjustmentEvent[];
  ProductAdsPaymentEventList?: AdPaymentEvent[];
}

interface ShipmentEvent {
  PostedDate?: string;
  ShipmentItemList?: {
    ItemChargeList?: { ChargeType: string; ChargeAmount: { CurrencyAmount: number } }[];
    ItemFeeList?: { FeeType: string; FeeAmount: { CurrencyAmount: number } }[];
    QuantityShipped?: number;
  }[];
}

interface AdjustmentEvent {
  AdjustmentType?: string;
  PostedDate?: string;
  AdjustmentAmount?: { CurrencyAmount: number };
  AdjustmentItemList?: {
    Quantity?: number;
    PerUnitAmount?: { CurrencyAmount: number };
  }[];
}

interface AdPaymentEvent {
  postedDate?: string;
  transactionType?: string;
  transactionValue?: { CurrencyAmount: number };
}

async function fetchFinancialEvents(
  postedAfter: string,
  postedBefore: string,
  token: string,
): Promise<FinancialEvents> {
  const all: FinancialEvents = {
    ShipmentEventList: [],
    AdjustmentEventList: [],
    ProductAdsPaymentEventList: [],
  };

  let nextToken: string | undefined;
  do {
    const params: Record<string, string> = {
      PostedAfter: postedAfter,
      PostedBefore: postedBefore,
      MaxResultsPerPage: "100",
      ...(nextToken ? { NextToken: nextToken } : {}),
    };
    const { url, headers } = signedGet("/finances/v0/financialEvents", params, token);
    const res = await fetch(url, { headers });
    const json = (await res.json()) as { payload?: { FinancialEvents?: FinancialEvents; NextToken?: string } };
    const fe = json.payload?.FinancialEvents ?? {};
    all.ShipmentEventList!.push(...(fe.ShipmentEventList ?? []));
    all.AdjustmentEventList!.push(...(fe.AdjustmentEventList ?? []));
    all.ProductAdsPaymentEventList!.push(...(fe.ProductAdsPaymentEventList ?? []));
    nextToken = json.payload?.NextToken;
    if (nextToken) await new Promise((r) => setTimeout(r, 500));
  } while (nextToken);

  return all;
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

interface DayFinancials {
  fbaFees: number;
  referralFees: number;
  refundCount: number;
  refundAmount: number;
  adCost: number;
}

function aggregateFinancials(events: FinancialEvents): DayFinancials {
  let fbaFees = 0;
  let referralFees = 0;
  let refundCount = 0;
  let refundAmount = 0;
  let adCost = 0;

  // Shipment events → FBA fees + referral fees
  for (const evt of events.ShipmentEventList ?? []) {
    for (const item of evt.ShipmentItemList ?? []) {
      for (const fee of item.ItemFeeList ?? []) {
        const amt = fee.FeeAmount.CurrencyAmount;
        if (fee.FeeType?.includes("FBAPerUnit") || fee.FeeType?.includes("FulfillmentFee")) {
          fbaFees += Math.abs(amt);
        } else if (fee.FeeType === "ReferralFee" || fee.FeeType === "Commission") {
          referralFees += Math.abs(amt);
        }
      }
    }
  }

  // Adjustment events → refunds
  for (const evt of events.AdjustmentEventList ?? []) {
    const type = evt.AdjustmentType ?? "";
    if (
      type.includes("REFUND") ||
      type.includes("REVERSAL") ||
      type === "COMPENSATED_CLAWBACK" ||
      type === "GOODWILL"
    ) {
      const amt = Math.abs(evt.AdjustmentAmount?.CurrencyAmount ?? 0);
      if (amt > 0) {
        refundCount++;
        refundAmount += amt;
      }
    }
  }

  // Ad payment events → advertising cost
  for (const evt of events.ProductAdsPaymentEventList ?? []) {
    if (evt.transactionType === "Charge") {
      adCost += Math.abs(evt.transactionValue?.CurrencyAmount ?? 0);
    }
  }

  return { fbaFees, referralFees, refundCount, refundAmount, adCost };
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export interface AmazonFinancialsSyncResult {
  daysProcessed: number;
  syncLogId: string;
}

export async function syncAmazonFinancials(daysBack = 7): Promise<AmazonFinancialsSyncResult> {
  const log = await db.syncLog.create({ data: { source: "amazon_financials", status: "running" } });

  try {
    const token = await getLwaAccessToken();
    let daysProcessed = 0;

    for (let i = 0; i < daysBack; i++) {
      const approxMs = Date.now() - i * 86_400_000;
      const pdtDate = formatInTimeZone(new Date(approxMs), BUSINESS_TZ, "yyyy-MM-dd");
      const [y, m, d] = pdtDate.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));

      // Use PDT midnight boundaries converted to UTC for financial events
      const postedAfter = new Date(dbDate.getTime() + 7 * 3_600_000).toISOString();
      const postedBefore = new Date(dbDate.getTime() + 31 * 3_600_000).toISOString();

      const events = await fetchFinancialEvents(postedAfter, postedBefore, token);
      const fin = aggregateFinancials(events);

      // Update FactSalesDaily with fee/refund data
      await db.factSalesDaily.updateMany({
        where: { date: dbDate, channel: "amazon" },
        data: {
          fbaFees: fin.fbaFees || null,
          referralFees: fin.referralFees || null,
          refundCount: fin.refundCount,
          refundAmount: fin.refundAmount || null,
        },
      });

      daysProcessed++;
      if (i < daysBack - 1) await new Promise((r) => setTimeout(r, 500));
    }

    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "success", finishedAt: new Date(), recordsUpserted: daysProcessed },
    });

    return { daysProcessed, syncLogId: log.id };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}
