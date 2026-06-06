// Backfill Meta Ads insights + entity metadata into the new hierarchy tables.
//
//   dotenv -e .env.local -- tsx scripts/backfill-meta.ts [days]
//
// `days` defaults to 30. Runs the full syncMeta (account + campaign + ad set +
// ad insights, plus campaign/ad set/ad metadata) for the trailing window. Run
// outside the Next dev server so it always uses the freshly-generated Prisma
// client. Large windows (≥60d) at ad level can be slow — that's expected.
import { syncMeta } from "../src/lib/sync/meta";

async function main() {
  const days = Number(process.argv[2] ?? "30");
  const daysBack = Number.isFinite(days) && days > 0 ? Math.min(Math.floor(days), 365) : 30;

  console.log(`Backfilling Meta Ads for the last ${daysBack} day(s)…`);
  const started = Date.now();
  const result = await syncMeta(daysBack);
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `Done in ${secs}s — ${result.insightRows} insight rows, ${result.entityRows} entity rows ` +
      `(${result.rowsUpserted} total). SyncLog ${result.syncLogId}.`,
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .then(() => process.exit(0));
