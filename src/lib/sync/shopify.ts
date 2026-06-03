import { format, subDays } from "date-fns";
import { db } from "@/lib/db";
import { sleep, windsorFetch, type WindsorRow } from "@/lib/windsor";

const CONNECTOR = "shopify";

// Daily aggregate fields from Windsor's Shopify `orders` table.
// order_net_sales is computed by Shopify as gross_sales − discounts − returns,
// so we don't need a separate refunds field for the daily roll-up.
const FIELDS = [
  "account_name",
  "date",
  "order_gross_sales",
  "order_net_sales",
  "order_total_discounts",
  "order_total_count",
  "order_quantity",
  "order_cost_of_goods_sold",
  "order_currency",
] as const;

const F = {
  account: "account_name",
  date: "date",
  gross: "order_gross_sales",
  net: "order_net_sales",
  discounts: "order_total_discounts",
  orders: "order_total_count",
  units: "order_quantity",
  cogs: "order_cost_of_goods_sold",
  currency: "order_currency",
} as const;

function toNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function toString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.length > 0 ? v : fallback;
}

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
  const projectEvery = Math.max(1, opts.projectEvery ?? 7);
  const perDayTimeoutMs = opts.perDayTimeoutMs ?? 30_000;
  const delayMs = opts.delayMs ?? 500;

  const log = await db.syncLog.create({
    data: { source: CONNECTOR, status: "running" },
  });

  let rowsUpserted = 0;
  let daysSucceeded = 0;
  const failures: { date: string; error: string }[] = [];
  let sinceProjection = 0;

  try {
    const today = new Date();

    for (let i = 0; i < daysBack; i++) {
      const date = subDays(today, i);
      const dateStr = format(date, "yyyy-MM-dd");

      try {
        const rows = await windsorFetch({
          connector: CONNECTOR,
          date_from: dateStr,
          date_to: dateStr,
          fields: [...FIELDS],
          timeoutMs: perDayTimeoutMs,
        });

        for (const row of rows) {
          await upsertShopifyRow(row, dateStr);
          rowsUpserted++;
        }
        daysSucceeded++;
        sinceProjection++;
      } catch (err) {
        failures.push({
          date: dateStr,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (sinceProjection >= projectEvery) {
        await projectShopifyToFact(daysBack);
        sinceProjection = 0;
      }

      if (i < daysBack - 1) await sleep(delayMs);
    }

    await projectShopifyToFact(daysBack);

    const status = failures.length === 0 ? "success" : daysSucceeded > 0 ? "partial" : "error";
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status,
        finishedAt: new Date(),
        recordsUpserted: rowsUpserted,
        errorMessage:
          failures.length > 0
            ? `${failures.length} day(s) failed: ${failures
                .slice(0, 5)
                .map((f) => `${f.date}: ${f.error}`)
                .join("; ")}${failures.length > 5 ? ` (+${failures.length - 5} more)` : ""}`
            : null,
      },
    });

    return {
      daysRequested: daysBack,
      daysSucceeded,
      rowsUpserted,
      failures,
      syncLogId: log.id,
    };
  } catch (err) {
    await db.syncLog.update({
      where: { id: log.id },
      data: {
        status: "error",
        finishedAt: new Date(),
        recordsUpserted: rowsUpserted,
        errorMessage: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

async function upsertShopifyRow(row: WindsorRow, dateStr: string): Promise<void> {
  const shopDomain = toString(row[F.account]);
  if (!shopDomain) return;

  const date = new Date(`${dateStr}T00:00:00Z`);
  const gross = toNumber(row[F.gross]);
  const net = toNumber(row[F.net]);
  const discounts = toNumber(row[F.discounts]);
  const orderCount = Math.round(toNumber(row[F.orders]));
  const unitsSold = Math.round(toNumber(row[F.units]));
  const cogsRaw = row[F.cogs];
  const cogs = cogsRaw === null || cogsRaw === undefined ? null : toNumber(cogsRaw);
  const currency = toString(row[F.currency], "USD");

  await db.rawShopifyOrdersDaily.upsert({
    where: { date_shopDomain: { date, shopDomain } },
    update: {
      grossSales: gross,
      netSales: net,
      discounts,
      cogs,
      orderCount,
      unitsSold,
      currency,
      syncedAt: new Date(),
    },
    create: {
      date,
      shopDomain,
      grossSales: gross,
      netSales: net,
      discounts,
      cogs,
      orderCount,
      unitsSold,
      currency,
    },
  });
}

export async function projectShopifyToFact(daysBack: number): Promise<void> {
  const since = subDays(new Date(), daysBack);
  const rawRows = await db.rawShopifyOrdersDaily.findMany({
    where: { date: { gte: since } },
  });

  for (const r of rawRows) {
    await db.factSalesDaily.upsert({
      where: {
        date_channel_subChannel: {
          date: r.date,
          channel: "shopify",
          subChannel: r.shopDomain,
        },
      },
      update: {
        grossSales: r.grossSales,
        netSales: r.netSales,
        cogs: r.cogs,
        discounts: r.discounts,
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
        units: r.unitsSold,
        orders: r.orderCount,
        currency: r.currency,
      },
    });
  }
}
