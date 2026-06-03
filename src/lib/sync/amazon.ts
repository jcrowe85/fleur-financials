import { format, subDays } from "date-fns";
import { db } from "@/lib/db";
import { sleep, windsorFetch, type WindsorRow } from "@/lib/windsor";

const CONNECTOR = "amazon_sp";

const FIELDS = [
  "account_name",
  "date",
  "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_amount",
  "sales_and_traffic_report_by_date__salesbydate_shippedproductsales_amount",
  "sales_and_traffic_report_by_date__salesbydate_unitsordered",
  "sales_and_traffic_report_by_date__salesbydate_unitsshipped",
  "sales_and_traffic_report_by_date__salesbydate_totalorderitems",
  "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_currencycode",
] as const;

const F = {
  account: "account_name",
  date: "date",
  ordered: "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_amount",
  shipped: "sales_and_traffic_report_by_date__salesbydate_shippedproductsales_amount",
  unitsOrdered: "sales_and_traffic_report_by_date__salesbydate_unitsordered",
  unitsShipped: "sales_and_traffic_report_by_date__salesbydate_unitsshipped",
  orderItems: "sales_and_traffic_report_by_date__salesbydate_totalorderitems",
  currency: "sales_and_traffic_report_by_date__salesbydate_orderedproductsales_currencycode",
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

// Account IDs look like "A1YGQT1903ICNX-US"; the suffix after the last dash
// is the marketplace. New regions added in Windsor flow through automatically.
function marketplaceFromAccount(accountId: string): string {
  const idx = accountId.lastIndexOf("-");
  return idx >= 0 ? accountId.slice(idx + 1) : accountId;
}

export interface AmazonSyncOptions {
  daysBack?: number;
  /** Project raw → fact every `projectEvery` days. Default 7. */
  projectEvery?: number;
  /** Per-day Windsor request timeout in ms. Default 30000. */
  perDayTimeoutMs?: number;
  /** Ms to sleep between day requests. Default 500. */
  delayMs?: number;
}

export interface AmazonSyncResult {
  daysRequested: number;
  daysSucceeded: number;
  rowsUpserted: number;
  failures: { date: string; error: string }[];
  syncLogId: string;
}

export async function syncAmazon(
  optsOrDaysBack: number | AmazonSyncOptions = 7,
): Promise<AmazonSyncResult> {
  const opts: AmazonSyncOptions =
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
          await upsertAmazonRow(row, dateStr);
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

      // Project periodically so partial backfills surface in the dashboard.
      if (sinceProjection >= projectEvery) {
        await projectAmazonToFact(daysBack);
        sinceProjection = 0;
      }

      if (i < daysBack - 1) await sleep(delayMs);
    }

    // Final projection for the tail of the window.
    await projectAmazonToFact(daysBack);

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

async function upsertAmazonRow(row: WindsorRow, dateStr: string): Promise<void> {
  const accountId = toString(row[F.account]);
  if (!accountId) return;

  const date = new Date(`${dateStr}T00:00:00Z`);
  const ordered = toNumber(row[F.ordered]);
  const shipped = toNumber(row[F.shipped]);
  const unitsOrdered = Math.round(toNumber(row[F.unitsOrdered]));
  const unitsShipped = Math.round(toNumber(row[F.unitsShipped]));
  const orderItems = Math.round(toNumber(row[F.orderItems]));
  const currency = toString(row[F.currency], "USD");

  await db.rawAmazonSalesDaily.upsert({
    where: { date_accountId: { date, accountId } },
    update: {
      marketplace: marketplaceFromAccount(accountId),
      orderedSalesAmount: ordered,
      shippedSalesAmount: shipped,
      unitsOrdered,
      unitsShipped,
      totalOrderItems: orderItems,
      currency,
      syncedAt: new Date(),
    },
    create: {
      date,
      accountId,
      marketplace: marketplaceFromAccount(accountId),
      orderedSalesAmount: ordered,
      shippedSalesAmount: shipped,
      unitsOrdered,
      unitsShipped,
      totalOrderItems: orderItems,
      currency,
    },
  });
}

// Project the rolling window of raw Amazon rows into FactSalesDaily.
// Net sales == ordered sales for now (Amazon doesn't expose refunds/discounts
// at this granularity in the sales_and_traffic report).
export async function projectAmazonToFact(daysBack: number): Promise<void> {
  const since = subDays(new Date(), daysBack);
  const rawRows = await db.rawAmazonSalesDaily.findMany({
    where: { date: { gte: since } },
  });

  for (const r of rawRows) {
    await db.factSalesDaily.upsert({
      where: {
        date_channel_subChannel: {
          date: r.date,
          channel: "amazon",
          subChannel: r.marketplace,
        },
      },
      update: {
        grossSales: r.orderedSalesAmount,
        netSales: r.orderedSalesAmount,
        units: r.unitsOrdered,
        orders: r.totalOrderItems,
        currency: r.currency,
      },
      create: {
        date: r.date,
        channel: "amazon",
        subChannel: r.marketplace,
        grossSales: r.orderedSalesAmount,
        netSales: r.orderedSalesAmount,
        units: r.unitsOrdered,
        orders: r.totalOrderItems,
        currency: r.currency,
      },
    });
  }
}
