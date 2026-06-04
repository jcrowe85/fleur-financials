import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { db } from "@/lib/db";

const SHOPIFY_API_VERSION = "unstable";
const BUSINESS_TZ = process.env.BUSINESS_TIMEZONE ?? "America/Los_Angeles";

function businessDateOf(ms: number): string {
  return formatInTimeZone(new Date(ms), BUSINESS_TZ, "yyyy-MM-dd");
}

// ─── Shared Admin GraphQL fetch ───────────────────────────────────────────────

async function shopifyAdminFetch(query: string): Promise<unknown> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN!;
  const token =
    process.env.SHOPIFY_PARTNER_ACCESS_TOKEN ?? process.env.SHOPIFY_ADMIN_ACCESS_TOKEN!;

  const res = await fetch(
    `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );

  const json = await res.json() as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors[0].message}`);
  return json.data;
}

// ─── ShopifyQL ────────────────────────────────────────────────────────────────

interface ShopifyqlRow {
  [key: string]: string;
}

async function shopifyqlQuery(ql: string): Promise<ShopifyqlRow[]> {
  const data = await shopifyAdminFetch(
    `{ shopifyqlQuery(query: ${JSON.stringify(ql)}) {
        tableData { columns { name dataType } rows }
        parseErrors
      } }`,
  ) as {
    shopifyqlQuery?: {
      tableData?: { columns: { name: string }[]; rows: ShopifyqlRow[] };
      parseErrors?: string[];
    };
  };

  const result = data.shopifyqlQuery;
  if (result?.parseErrors?.length) {
    throw new Error(`ShopifyQL parse error: ${result.parseErrors[0]}`);
  }
  return result?.tableData?.rows ?? [];
}

// ─── Variant costs ────────────────────────────────────────────────────────────

interface VariantMeta { cost: number; price: number }

// TODO: replace with a live fetch once the Shopify app has read_products scope.
// Seeded from inventoryItem.unitCost via the MCP on 2026-06-03.
// Update this map whenever product costs change in Shopify.
const VARIANT_COST_MAP: Record<string, VariantMeta> = {
  "44826097221811": { cost: 6.76,  price: 58.00  }, // bloom serum — Buy 1
  "44826097254579": { cost: 20.28, price: 174.00 }, // bloom serum — Buy 3
  "44826097287347": { cost: 40.56, price: 348.00 }, // bloom serum — Buy 6
  "44138710597811": { cost: 2.30,  price: 30.00  }, // Derma Stamp
  "45210987921587": { cost: 20.28, price: 174.00 }, // 3x serum (legacy listing)
  "45210986807475": { cost: 40.56, price: 348.00 }, // 6x serum (legacy listing)
  "45032094597299": { cost: 2.75,  price: 42.00  }, // Detangling Comb
  "45533271556275": { cost: 0.26,  price: 16.00  }, // Roller Ball Attachment
  "45033200713907": { cost: 36.00, price: 45.00  }, // Heat Shield
  "45033276080307": { cost: 5.50,  price: 35.00  }, // Satin Pillow
};

function getVariantMeta(): Map<string, VariantMeta> {
  return new Map(Object.entries(VARIANT_COST_MAP));
}

// ─── Variant units per day ────────────────────────────────────────────────────

async function fetchDailyCogs(
  startDate: string,
  endDate: string,
): Promise<{ dailyCogs: Map<string, number>; dailyUnits: Map<string, number> }> {
  // gross_sales = price × units (pre-discount), so units = gross_sales / price
  // COGS per variant-day = (gross_sales / price) × unit_cost
  const [rows, variantMeta] = await Promise.all([
    shopifyqlQuery(
      `FROM sales SHOW gross_sales TIMESERIES day GROUP BY product_variant_id SINCE ${startDate} UNTIL ${endDate}`,
    ),
    Promise.resolve(getVariantMeta()),
  ]);

  const dailyCogs = new Map<string, number>();
  const dailyUnits = new Map<string, number>();
  for (const row of rows) {
    const day = row.day;
    const variantId = row.product_variant_id;
    const grossSales = parseFloat(row.gross_sales ?? "0") || 0;
    if (!day || !variantId || grossSales <= 0) continue;

    const meta = variantMeta.get(variantId);
    if (!meta || !meta.price) continue;

    const units = grossSales / meta.price;
    dailyUnits.set(day, (dailyUnits.get(day) ?? 0) + units);
    dailyCogs.set(day, (dailyCogs.get(day) ?? 0) + units * meta.cost);
  }
  return { dailyCogs, dailyUnits };
}

// ─── Sync ─────────────────────────────────────────────────────────────────────

export interface ShopifySyncOptions {
  daysBack?: number;
  projectEvery?: number;
  perDayTimeoutMs?: number;
  delayMs?: number;
}

export interface ShopifySyncResult {
  daysRequested: number;
  daysSucceeded: number;
  rowsUpserted: number;
  failures: { date: string; error: string }[];
  syncLogId: string;
}

export async function syncShopify(
  optsOrDaysBack: number | ShopifySyncOptions = 7,
): Promise<ShopifySyncResult> {
  const opts: ShopifySyncOptions =
    typeof optsOrDaysBack === "number" ? { daysBack: optsOrDaysBack } : optsOrDaysBack;
  const daysBack = opts.daysBack ?? 7;

  const log = await db.syncLog.create({ data: { source: "shopify", status: "running" } });

  let rowsUpserted = 0;
  let daysSucceeded = 0;
  const failures: { date: string; error: string }[] = [];

  try {
    const domain = process.env.SHOPIFY_STORE_DOMAIN!;
    const todayPdt = businessDateOf(Date.now());
    const startPdt = businessDateOf(Date.now() - (daysBack - 1) * 86_400_000);

    const emptyResult = { dailyCogs: new Map<string, number>(), dailyUnits: new Map<string, number>() };
    const [salesRows, { dailyCogs, dailyUnits }] = await Promise.all([
      shopifyqlQuery(
        `FROM sales SHOW gross_sales, discounts, returns, net_sales, orders TIMESERIES day SINCE ${startPdt} UNTIL ${todayPdt}`,
      ),
      fetchDailyCogs(startPdt, todayPdt).catch(() => emptyResult),
    ]);

    for (let i = 0; i < daysBack; i++) {
      const dateStr = businessDateOf(Date.now() - i * 86_400_000);
      const [y, m, d] = dateStr.split("-").map(Number);
      const dbDate = new Date(Date.UTC(y, m - 1, d));

      try {
        const row = salesRows.find((r) => r.day === dateStr);
        const grossSales = parseFloat(row?.gross_sales ?? "0") || 0;
        const netSales = parseFloat(row?.net_sales ?? "0") || 0;
        const orderCount = Math.round(parseFloat(row?.orders ?? "0") || 0);
        // discounts and returns are negative in ShopifyQL; store as positive amounts
        const discounts = Math.abs(parseFloat(row?.discounts ?? "0") || 0);
        const returnsAmount = Math.abs(parseFloat(row?.returns ?? "0") || 0) || null;
        const cogs = dailyCogs.get(dateStr) ?? null;
        const unitsSold = Math.round(dailyUnits.get(dateStr) ?? 0);

        await db.rawShopifyOrdersDaily.upsert({
          where: { date_shopDomain: { date: dbDate, shopDomain: domain } },
          update: { grossSales, netSales, discounts, returnsAmount, orderCount, unitsSold, cogs, syncedAt: new Date() },
          create: {
            date: dbDate,
            shopDomain: domain,
            grossSales,
            netSales,
            discounts,
            returnsAmount,
            cogs,
            orderCount,
            unitsSold,
            currency: "USD",
          },
        });

        rowsUpserted++;
        daysSucceeded++;
      } catch (err) {
        failures.push({ date: dateStr, error: err instanceof Error ? err.message : String(err) });
      }
    }

    await projectShopifyToFact(daysBack);

    const status = failures.length === 0 ? "success" : daysSucceeded > 0 ? "partial" : "error";
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsUpserted: rowsUpserted,
        errorMessage: failures.length > 0
          ? failures.slice(0, 5).map((f) => `${f.date}: ${f.error}`).join("; ")
          : null,
      },
    });

    return { daysRequested: daysBack, daysSucceeded, rowsUpserted, failures, syncLogId: log.id };
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).replace(/\0/g, "");
    await db.syncLog.update({
      where: { id: log.id },
      data: { status: "error", finishedAt: new Date(), errorMessage: msg },
    });
    throw err;
  }
}

export async function projectShopifyToFact(daysBack: number): Promise<void> {
  const since = subDays(new Date(), daysBack);
  const rawRows = await db.rawShopifyOrdersDaily.findMany({ where: { date: { gte: since } } });

  for (const r of rawRows) {
    await db.factSalesDaily.upsert({
      where: {
        date_channel_subChannel: { date: r.date, channel: "shopify", subChannel: r.shopDomain },
      },
      update: {
        grossSales: r.grossSales,
        netSales: r.netSales,
        cogs: r.cogs,
        discounts: r.discounts,
        refundAmount: r.returnsAmount,
        units: r.unitsSold,
        orders: r.orderCount,
        currency: r.currency,
      },
      create: {
        date: r.date,
        channel: "shopify",
        subChannel: r.shopDomain,
        grossSales: r.grossSales,
        netSales: r.netSales,
        cogs: r.cogs,
        discounts: r.discounts,
        refundAmount: r.returnsAmount,
        units: r.unitsSold,
        orders: r.orderCount,
        currency: r.currency,
      },
    });
  }
}
