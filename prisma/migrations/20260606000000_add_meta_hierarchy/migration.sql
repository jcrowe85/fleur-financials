-- AlterTable
ALTER TABLE "FactSalesDaily" ADD COLUMN     "fbaFees" DECIMAL(12,2),
ADD COLUMN     "referralFees" DECIMAL(12,2),
ADD COLUMN     "refundAmount" DECIMAL(12,2),
ADD COLUMN     "refundCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "RawAmazonSalesDaily" ADD COLUMN     "cogs" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "RawShopifyOrdersDaily" ADD COLUMN     "returnsAmount" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "RawMetaAdsDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "revenue" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawMetaAdsDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaEntity" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "campaignId" TEXT,
    "adsetId" TEXT,
    "status" TEXT,
    "effectiveStatus" TEXT,
    "objective" TEXT,
    "dailyBudget" DECIMAL(12,2),
    "lifetimeBudget" DECIMAL(12,2),
    "creativeThumbUrl" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaInsightDaily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "level" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "inlineLinkClicks" INTEGER NOT NULL,
    "outboundClicks" INTEGER NOT NULL,
    "purchases" INTEGER NOT NULL,
    "purchaseValue" DECIMAL(12,2) NOT NULL,
    "addToCart" INTEGER NOT NULL,
    "initiateCheckout" INTEGER NOT NULL,
    "landingPageViews" INTEGER NOT NULL,
    "videoViews3s" INTEGER NOT NULL,
    "thruplays" INTEGER NOT NULL,
    "videoP25" INTEGER NOT NULL,
    "videoP50" INTEGER NOT NULL,
    "videoP75" INTEGER NOT NULL,
    "videoP100" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetaInsightDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RawMetaAdsDaily_date_idx" ON "RawMetaAdsDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RawMetaAdsDaily_date_key" ON "RawMetaAdsDaily"("date");

-- CreateIndex
CREATE INDEX "MetaEntity_level_idx" ON "MetaEntity"("level");

-- CreateIndex
CREATE INDEX "MetaEntity_campaignId_idx" ON "MetaEntity"("campaignId");

-- CreateIndex
CREATE INDEX "MetaEntity_adsetId_idx" ON "MetaEntity"("adsetId");

-- CreateIndex
CREATE INDEX "MetaInsightDaily_date_level_idx" ON "MetaInsightDaily"("date", "level");

-- CreateIndex
CREATE INDEX "MetaInsightDaily_entityId_idx" ON "MetaInsightDaily"("entityId");

-- CreateIndex
CREATE UNIQUE INDEX "MetaInsightDaily_date_level_entityId_key" ON "MetaInsightDaily"("date", "level", "entityId");
