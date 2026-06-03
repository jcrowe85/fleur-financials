-- AlterTable
ALTER TABLE "FactSalesDaily" ADD COLUMN     "cogs" DECIMAL(12,2),
ADD COLUMN     "discounts" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "RawShopifyOrdersDaily" ADD COLUMN     "cogs" DECIMAL(12,2),
ADD COLUMN     "discounts" DECIMAL(12,2) NOT NULL DEFAULT 0;
