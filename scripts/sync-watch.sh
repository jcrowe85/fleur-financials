#!/bin/bash
# Runs all syncs every 15 minutes while you're developing locally.
# Usage: bash scripts/sync-watch.sh

SECRET=$(grep CRON_SECRET .env.local | cut -d= -f2)
INTERVAL=900  # 15 minutes

echo "Sync watcher started — running every ${INTERVAL}s. Ctrl+C to stop."

while true; do
  echo ""
  echo "[$(date '+%H:%M:%S')] Syncing..."

  SHOPIFY=$(curl -s -X GET "http://localhost:3000/api/sync/shopify?days=2" \
    -H "Authorization: Bearer $SECRET")
  echo "  Shopify: $(echo $SHOPIFY | grep -o '"ok":[^,}]*' | head -1), $(echo $SHOPIFY | grep -o '"rowsUpserted":[^,}]*')"

  AMAZON=$(curl -s -X GET "http://localhost:3000/api/sync/amazon?days=2&timeoutMs=180000" \
    -H "Authorization: Bearer $SECRET")
  echo "  Amazon:  $(echo $AMAZON | grep -o '"ok":[^,}]*' | head -1), $(echo $AMAZON | grep -o '"rowsUpserted":[^,}]*')"

  # Amazon Ads uses a two-phase flow: first call submits the report, second call
  # (run ~15+ min later) downloads it. Both phases hit the same endpoint.
  AMAZON_ADS=$(curl -s -X GET "http://localhost:3000/api/sync/amazon-ads?days=7" \
    -H "Authorization: Bearer $SECRET")
  ADS_STATUS=$(echo $AMAZON_ADS | grep -o '"status":"[^"]*"' | head -1)
  ADS_ROWS=$(echo $AMAZON_ADS | grep -o '"rowsUpserted":[^,}]*')
  echo "  AmazonAds: $(echo $AMAZON_ADS | grep -o '"ok":[^,}]*' | head -1), $ADS_STATUS${ADS_ROWS:+, $ADS_ROWS}"

  echo "  Next sync at $(date -d "+${INTERVAL} seconds" '+%H:%M:%S' 2>/dev/null || date -v+${INTERVAL}S '+%H:%M:%S')"
  sleep $INTERVAL
done
