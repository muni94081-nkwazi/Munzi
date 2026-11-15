// ─── Shared Product & Catalogue Types ──────────────────────────────────────────
// Authoritative TypeScript interfaces matching the database models in
// backend/services/product-service/prisma/schema.prisma

import { z } from 'zod';

export type ProductStatus =
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'DRAFT'
  | 'ARCHIVED'
  | 'OUT_OF_STOCK';

export type ProductCondition =
  | 'NEW'
  | 'REFURBISHED'
  | 'USED_LIKE_NEW'
  | 'USED_GOOD'
  | 'USED_FAIR'
  | 'OPEN_BOX'
  | 'FOR_PARTS';

export type ExternalProductCondition =
  | 'new'
  | 'refurbished'
  | 'used_like_new'
  | 'used_good'
  | 'used_fair'
  | 'open_box'
  | 'for_parts';

export const CONDITION_MAP_EXTERNAL_TO_INTERNAL: Record<string, ProductCondition> = {
  new: 'NEW',
  refurbished: 'REFURBISHED',
  used_like_new: 'USED_LIKE_NEW',
  like_new: 'USED_LIKE_NEW',
  used_good: 'USED_GOOD',
  used_fair: 'USED_FAIR',
  open_box: 'OPEN_BOX',
  for_parts: 'FOR_PARTS',
  // Uppercase direct mappings for robust bidirectional parsing
  NEW: 'NEW',
  REFURBISHED: 'REFURBISHED',
  USED_LIKE_NEW: 'USED_LIKE_NEW',
  LIKE_NEW: 'USED_LIKE_NEW',
  USED_GOOD: 'USED_GOOD',
  USED_FAIR: 'USED_FAIR',
  OPEN_BOX: 'OPEN_BOX',
  FOR_PARTS: 'FOR_PARTS',
};

export const CONDITION_MAP_INTERNAL_TO_EXTERNAL: Record<ProductCondition, ExternalProductCondition> = {
  NEW: 'new',
  REFURBISHED: 'refurbished',
  USED_LIKE_NEW: 'used_like_new',
  USED_GOOD: 'used_good',
  USED_FAIR: 'used_fair',
  OPEN_BOX: 'open_box',
  FOR_PARTS: 'for_parts',
};

export function isValidCondition(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const key = val.trim().toLowerCase();
  return key in CONDITION_MAP_EXTERNAL_TO_INTERNAL;
}

export function toInternalCondition(val?: string | null): ProductCondition {
  if (!val) return 'NEW';
  const trimmed = val.trim();
  const lower = trimmed.toLowerCase();
  const mapped = CONDITION_MAP_EXTERNAL_TO_INTERNAL[lower] ?? CONDITION_MAP_EXTERNAL_TO_INTERNAL[trimmed];
  if (!mapped) {
    throw Object.assign(
      new Error(`Invalid product condition "${val}". Allowed values: new, used_like_new, used_good, used_fair, refurbished, open_box, for_parts`),
      { status: 422 },
    );
  }
  return mapped;
}

export function toExternalCondition(val?: ProductCondition | string | null): ExternalProductCondition {
  if (!val) return 'new';
  if (typeof val === 'string' && val in CONDITION_MAP_INTERNAL_TO_EXTERNAL) {
    return CONDITION_MAP_INTERNAL_TO_EXTERNAL[val as ProductCondition];
  }
  const lower = (val as string).toLowerCase();
  if (lower in CONDITION_MAP_EXTERNAL_TO_INTERNAL) {
    const internal = CONDITION_MAP_EXTERNAL_TO_INTERNAL[lower];
    return CONDITION_MAP_INTERNAL_TO_EXTERNAL[internal];
  }
  return 'new';
}

export type AttributeType =
  | 'TEXT'
  | 'NUMBER'
  | 'ENUM'
  | 'BOOLEAN'
  | 'COLOR'
  | 'DATE';

export interface Category {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  parentId?: string | null;
  level: number;
  path: string;
  sortOrder: number;
  commissionFeePercent: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CategoryAttribute {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  type: AttributeType;
  allowedValues?: string[] | null;
  unit?: string | null;
  isVariantAxis: boolean;
  isFilterable: boolean;
  isRequired: boolean;
  sortOrder: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductSpecification {
  id: string;
  productId: string;
  key: string;
  value: string;
  group: string;
  sortOrder: number;
  createdAt?: string;
}

export interface VariantAttributeValue {
  id: string;
  variantId: string;
  attributeId: string;
  value: string;
  createdAt?: string;
}

// ── Wholesale Tier Runtime Validation ────────────────────────────────────────

export const WholesaleTierSchema = z.object({
  minQty: z.number().int().positive({ message: 'Minimum quantity must be a positive integer.' }),
  price: z.number().positive({ message: 'Tier price must be a positive number.' }).finite({ message: 'Tier price must be finite.' }),
  label: z.string().max(100).optional(),
});

export type WholesaleTier = z.infer<typeof WholesaleTierSchema>;

export const WholesaleTiersArraySchema = z
  .array(WholesaleTierSchema)
  .max(20, { message: 'Maximum of 20 wholesale pricing tiers allowed.' })
  .refine(
    (tiers) => {
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].minQty <= tiers[i - 1].minQty) {
          return false;
        }
      }
      return true;
    },
    { message: 'Wholesale tiers must have strictly increasing minimum quantities.' },
  )
  .refine(
    (tiers) => {
      for (let i = 1; i < tiers.length; i++) {
        if (tiers[i].price >= tiers[i - 1].price) {
          return false;
        }
      }
      return true;
    },
    { message: 'Wholesale tiers must have strictly decreasing prices (volume discounts).' },
  );

/**
 * Validates wholesale pricing tiers data structure and consistency with base list price.
 */
export function validateWholesaleTiers(
  tiers: unknown,
  basePrice?: number,
): { valid: boolean; error?: string; data?: WholesaleTier[] } {
  if (tiers === null || tiers === undefined) {
    return { valid: true, data: undefined };
  }

  const parsed = WholesaleTiersArraySchema.safeParse(tiers);
  if (!parsed.success) {
    return { valid: false, error: parsed.error.issues[0]?.message ?? 'Invalid wholesale tiers.' };
  }

  if (basePrice !== undefined && parsed.data.length > 0) {
    if (parsed.data[0].price >= basePrice) {
      return {
        valid: false,
        error: `First wholesale tier price (${parsed.data[0].price}) must be lower than base price (${basePrice}).`,
      };
    }
  }

  return { valid: true, data: parsed.data };
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  attributes: Record<string, string>;
  price: number;
  compareAtPrice?: number | null;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  barcode?: string | null;
  weightKg?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  images: string[];
  active: boolean;
  attributeValues?: VariantAttributeValue[];
  availableStock?: number;
  inStock?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  sellerId: string;
  categoryId?: string | null;
  category?: Category | null;
  status: ProductStatus;
  condition: ExternalProductCondition | ProductCondition;
  moq?: number | null;
  wholesaleTiers?: WholesaleTier[] | null;
  basePrice: number;
  minVariantPrice?: number | null;
  compareAtPrice?: number | null;
  currency: string;
  brand?: string | null;
  tags: string[];
  images: string[];
  imageUrls?: string[];
  averageRating: number;
  reviewCount: number;
  viewCount: number;
  rejectionReason?: string | null;
  submittedAt?: string | null;
  moderatedAt?: string | null;
  variants?: ProductVariant[];
  specifications?: ProductSpecification[];
  createdAt: string;
  updatedAt: string;
}
