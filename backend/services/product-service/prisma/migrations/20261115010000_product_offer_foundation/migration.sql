-- Migration: 20261115010000_product_offer_foundation
-- Description: Add ProductOffer, ProductQuarantineLog, composite keys and offer relationships.
-- Status: PREPARED ONLY — STRICTLY UNAPPLIED.
-- Ownership: Owned exclusively by @muni/product-service.

-- 1. Create Enums if they do not exist
DO $$ BEGIN
  CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'OUT_OF_STOCK', 'SUSPENDED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED', 'EXPIRED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Add Multi-Vendor Aggregated Columns to Product
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "minOfferPrice" DECIMAL(12, 2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "maxOfferPrice" DECIMAL(12, 2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "activeOfferCount" INTEGER NOT NULL DEFAULT 0;

-- 3. Add Composite Unique Key on ProductVariant for foreign key reference
DO $$ BEGIN
  ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_id_productId_key" UNIQUE ("id", "productId");
EXCEPTION
  WHEN duplicate_table THEN null;
  WHEN duplicate_object THEN null;
END $$;

-- 4. Create ProductOffer Table
CREATE TABLE IF NOT EXISTS "ProductOffer" (
  "id" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "sellerSku" TEXT,
  "price" DECIMAL(12, 2) NOT NULL,
  "compareAtPrice" DECIMAL(12, 2),
  "currency" TEXT NOT NULL DEFAULT 'UGX',
  "condition" "ProductCondition" NOT NULL DEFAULT 'NEW',
  "conditionNote" TEXT,
  "moq" INTEGER NOT NULL DEFAULT 1,
  "wholesaleTiers" JSONB,
  "stock" INTEGER NOT NULL DEFAULT 0,
  "reserved" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER NOT NULL DEFAULT 5,
  "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
  "isBuyBoxWinner" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductOffer_pkey" PRIMARY KEY ("id")
);

-- 5. Create Indexes on ProductOffer
CREATE UNIQUE INDEX IF NOT EXISTS "ProductOffer_sellerId_sellerSku_key" ON "ProductOffer"("sellerId", "sellerSku");
CREATE INDEX IF NOT EXISTS "ProductOffer_productId_status_price_idx" ON "ProductOffer"("productId", "status", "price");
CREATE INDEX IF NOT EXISTS "ProductOffer_variantId_status_price_idx" ON "ProductOffer"("variantId", "status", "price");
CREATE INDEX IF NOT EXISTS "ProductOffer_sellerId_status_idx" ON "ProductOffer"("sellerId", "status");
CREATE INDEX IF NOT EXISTS "ProductOffer_status_stock_idx" ON "ProductOffer"("status", "stock");

-- 6. Add Foreign Keys to ProductOffer
DO $$ BEGIN
  ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "ProductOffer" ADD CONSTRAINT "ProductOffer_variantId_productId_fkey"
    FOREIGN KEY ("variantId", "productId") REFERENCES "ProductVariant"("id", "productId") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 7. Add Multi-Vendor Fields and Relationships to InventoryReservation
ALTER TABLE "InventoryReservation" ADD COLUMN IF NOT EXISTS "offerId" TEXT;
ALTER TABLE "InventoryReservation" ADD COLUMN IF NOT EXISTS "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "InventoryReservation" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "InventoryReservation_offerId_status_idx" ON "InventoryReservation"("offerId", "status");
CREATE INDEX IF NOT EXISTS "InventoryReservation_expiresAt_status_idx" ON "InventoryReservation"("expiresAt", "status");

-- onDelete: Restrict prevents deleting an offer from destroying reservation audit history
DO $$ BEGIN
  ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "ProductOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 8. Create ProductQuarantineLog Table for Audit & Quarantine
CREATE TABLE IF NOT EXISTS "ProductQuarantineLog" (
  "id" VARCHAR(36) NOT NULL,
  "productId" TEXT NOT NULL,
  "sellerId" TEXT,
  "reason" TEXT NOT NULL,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductQuarantineLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductQuarantineLog_productId_idx" ON "ProductQuarantineLog"("productId");
CREATE INDEX IF NOT EXISTS "ProductQuarantineLog_sellerId_idx" ON "ProductQuarantineLog"("sellerId");
CREATE INDEX IF NOT EXISTS "ProductQuarantineLog_reason_idx" ON "ProductQuarantineLog"("reason");
