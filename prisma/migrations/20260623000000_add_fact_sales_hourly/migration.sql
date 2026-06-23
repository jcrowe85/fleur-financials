-- CreateTable
CREATE TABLE "FactSalesHourly" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "subChannel" TEXT NOT NULL,
    "grossSales" DECIMAL(12,2) NOT NULL,
    "netSales" DECIMAL(12,2) NOT NULL,
    "units" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactSalesHourly_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FactSalesHourly_date_channel_idx" ON "FactSalesHourly"("date", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "FactSalesHourly_date_hour_channel_subChannel_key" ON "FactSalesHourly"("date", "hour", "channel", "subChannel");
