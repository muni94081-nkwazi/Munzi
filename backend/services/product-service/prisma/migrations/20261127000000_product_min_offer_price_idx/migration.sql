-- Additive index for offer-aware price sorting and filtering on Product.
-- Matches @@index([status, minOfferPrice]) in prisma/schema.prisma.
CREATE INDEX IF NOT EXISTS "Product_status_minOfferPrice_idx" ON "Product"("status", "minOfferPrice");
