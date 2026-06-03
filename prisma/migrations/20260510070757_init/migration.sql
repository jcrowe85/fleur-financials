-- CreateTable
CREATE TABLE "RawAmazonSalesDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "orderedSalesAmount" DECIMAL(12,2) NOT NULL,
    "shippedSalesAmount" DECIMAL(12,2) NOT NULL,
    "unitsOrdered" INTEGER NOT NULL,
    "unitsShipped" INTEGER NOT NULL,
    "totalOrderItems" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawAmazonSalesDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawShopifyOrdersDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "grossSales" DECIMAL(12,2) NOT NULL,
    "netSales" DECIMAL(12,2) NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "unitsSold" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawShopifyOrdersDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTiktokAdsDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "conversionValue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTiktokAdsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactSalesDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "subChannel" TEXT NOT NULL,
    "grossSales" DECIMAL(12,2) NOT NULL,
    "netSales" DECIMAL(12,2) NOT NULL,
    "units" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactSalesDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactAdSpendDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "channel" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "attributedRevenue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactAdSpendDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawAmazonSalesDaily_date_idx" ON "RawAmazonSalesDaily"("date");

-- CreateIndex
CREATE INDEX "RawAmazonSalesDaily_marketplace_idx" ON "RawAmazonSalesDaily"("marketplace");

-- CreateIndex
CREATE UNIQUE INDEX "RawAmazonSalesDaily_date_accountId_key" ON "RawAmazonSalesDaily"("date", "accountId");

-- CreateIndex
CREATE INDEX "RawShopifyOrdersDaily_date_idx" ON "RawShopifyOrdersDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RawShopifyOrdersDaily_date_shopDomain_key" ON "RawShopifyOrdersDaily"("date", "shopDomain");

-- CreateIndex
CREATE INDEX "RawTiktokAdsDaily_date_idx" ON "RawTiktokAdsDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RawTiktokAdsDaily_date_accountId_campaignId_key" ON "RawTiktokAdsDaily"("date", "accountId", "campaignId");

-- CreateIndex
CREATE INDEX "FactSalesDaily_date_idx" ON "FactSalesDaily"("date");

-- CreateIndex
CREATE INDEX "FactSalesDaily_channel_idx" ON "FactSalesDaily"("channel");

-- CreateIndex
CREATE UNIQUE INDEX "FactSalesDaily_date_channel_subChannel_key" ON "FactSalesDaily"("date", "channel", "subChannel");

-- CreateIndex
CREATE INDEX "FactAdSpendDaily_date_idx" ON "FactAdSpendDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "FactAdSpendDaily_date_channel_key" ON "FactAdSpendDaily"("date", "channel");

-- CreateIndex
CREATE INDEX "SyncLog_source_startedAt_idx" ON "SyncLog"("source", "startedAt");
