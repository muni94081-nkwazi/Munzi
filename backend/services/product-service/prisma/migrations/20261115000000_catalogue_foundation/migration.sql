-- 1. Create Enums
CREATE TYPE "ProductCondition" AS ENUM ('NEW', 'REFURBISHED', 'USED_LIKE_NEW', 'USED_GOOD', 'USED_FAIR', 'OPEN_BOX', 'FOR_PARTS');
CREATE TYPE "AttributeType" AS ENUM ('TEXT', 'NUMBER', 'ENUM', 'BOOLEAN', 'COLOR', 'DATE');

-- 2. Alter Product Table
ALTER TABLE "Product" ADD COLUMN "condition" "ProductCondition" NOT NULL DEFAULT 'NEW';
ALTER TABLE "Product" ADD COLUMN "moq" INTEGER;
ALTER TABLE "Product" ADD COLUMN "wholesaleTiers" JSONB;

-- 3. Alter ProductVariant Table
ALTER TABLE "ProductVariant" ADD COLUMN "barcode" TEXT;

-- 4. Create CategoryAttribute Table
CREATE TABLE "CategoryAttribute" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "AttributeType" NOT NULL DEFAULT 'TEXT',
    "allowedValues" JSONB,
    "unit" TEXT,
    "isVariantAxis" BOOLEAN NOT NULL DEFAULT false,
    "isFilterable" BOOLEAN NOT NULL DEFAULT true,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryAttribute_pkey" PRIMARY KEY ("id")
);

-- 5. Create ProductSpecification Table
CREATE TABLE "ProductSpecification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'General',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductSpecification_pkey" PRIMARY KEY ("id")
);

-- 6. Create VariantAttributeValue Table
CREATE TABLE "VariantAttributeValue" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "attributeId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantAttributeValue_pkey" PRIMARY KEY ("id")
);

-- 7. Create Indexes
CREATE INDEX "Product_status_condition_idx" ON "Product"("status", "condition");
CREATE INDEX "ProductVariant_barcode_idx" ON "ProductVariant"("barcode");

CREATE UNIQUE INDEX "CategoryAttribute_categoryId_slug_key" ON "CategoryAttribute"("categoryId", "slug");
CREATE INDEX "CategoryAttribute_categoryId_active_sortOrder_idx" ON "CategoryAttribute"("categoryId", "active", "sortOrder");

CREATE UNIQUE INDEX "ProductSpecification_productId_key_key" ON "ProductSpecification"("productId", "key");
CREATE INDEX "ProductSpecification_productId_idx" ON "ProductSpecification"("productId");

CREATE UNIQUE INDEX "VariantAttributeValue_variantId_attributeId_key" ON "VariantAttributeValue"("variantId", "attributeId");
CREATE INDEX "VariantAttributeValue_attributeId_value_idx" ON "VariantAttributeValue"("attributeId", "value");

-- 8. Add Foreign Key Constraints
ALTER TABLE "CategoryAttribute" ADD CONSTRAINT "CategoryAttribute_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductSpecification" ADD CONSTRAINT "ProductSpecification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VariantAttributeValue" ADD CONSTRAINT "VariantAttributeValue_attributeId_fkey" FOREIGN KEY ("attributeId") REFERENCES "CategoryAttribute"("id") ON DELETE CASCADE ON UPDATE CASCADE;
