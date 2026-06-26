-- CreateTable
CREATE TABLE "GiftEngineAlert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "source" TEXT NOT NULL DEFAULT 'gift-engine',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "GiftEngineAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GiftEngineAlert_createdAt_idx" ON "GiftEngineAlert"("createdAt");

-- CreateIndex
CREATE INDEX "GiftEngineAlert_readAt_idx" ON "GiftEngineAlert"("readAt");
