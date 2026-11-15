import { prisma } from '../db/prisma.js';
import { refreshProductProjections } from './product.service.js';
import { validateAttributeValue, getCategoryAncestorIds } from './category-attribute.service.js';
import { z } from 'zod';

async function runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  if (typeof (prisma as any).$transaction === 'function') {
    return (prisma as any).$transaction(fn);
  }
  return fn(prisma);
}

export const VariantAttributeValueInputSchema = z.object({
  attributeId: z.string().min(1),
  value:       z.string().min(1).max(500),
});

export const CreateVariantSchema = z.object({
  sku:               z.string().min(1).max(100).optional(), // auto-generated if omitted
  attributes:        z.record(z.string()).default({}),      // { color: 'Red', size: 'M' }
  price:             z.number().positive(),
  compareAtPrice:    z.number().positive().optional(),
  stock:             z.number().int().min(0),
  lowStockThreshold: z.number().int().min(0).default(5),
  barcode:           z.string().max(100).optional().nullable(),
  weightKg:          z.number().positive().optional(),
  length:            z.number().positive().optional(),
  width:             z.number().positive().optional(),
  height:            z.number().positive().optional(),
  images:            z.array(z.string().url()).default([]),
  attributeValues:   z.array(VariantAttributeValueInputSchema)
    .refine(
      (items) => {
        const seen = new Set<string>();
        for (const item of items) {
          if (seen.has(item.attributeId)) return false;
          seen.add(item.attributeId);
        }
        return true;
      },
      { message: 'Duplicate attribute IDs are not allowed in variant attribute values.' },
    )
    .optional(),
});

export const UpdateVariantSchema = CreateVariantSchema.partial();

/**
 * Generate a deterministic SKU from product slug + attributes.
 * Example: 'mens-polo-shirt' + {color:'Red', size:'M'} → 'MPS-RED-M'
 */
export function generateSKU(productSlug: string, attributes: Record<string, string>): string {
  const prefix = productSlug
    .split('-')
    .slice(0, 3)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const attrPart = Object.values(attributes)
    .map((v) => v.toUpperCase().replace(/\\s+/g, '-').slice(0, 5))
    .join('-');
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  return `${prefix}-${attrPart}-${suffix}`;
}

/**
 * Look up a single variant by its own id — the checkout path's price oracle.
 *
 * checkout-service's pricing step re-reads every cart line through this
 * endpoint so the authoritative price comes from the catalogue rather than
 * from the cart snapshot (which may be stale) or the request body (which the
 * customer controls). It is therefore deliberately strict about what counts
 * as purchasable:
 *
 *   - the variant itself must be `active`
 *   - its parent product must be `ACTIVE` — a variant of a product still
 *     awaiting moderation, rejected, or archived must not be sellable just
 *     because the variant row was left enabled
 *
 * Returns null rather than throwing when either check fails; the caller turns
 * that into "no longer available" for the customer.
 */
export async function getVariantById(variantId: string, productId?: string) {
  const variant = await prisma.productVariant.findFirst({
    // When the caller addressed the variant through its product
    // (`/products/:id/variants/:variantId`) the two must agree. Without this
    // the nested route would happily return a variant belonging to a different
    // product, making the `:id` segment decorative and letting a caller probe
    // the catalogue through a product it is allowed to see.
    where: {
      id:      variantId,
      active:  true,
      // OUT_OF_STOCK is a DERIVED display state, not a delisting: inventory
      // flips a product to it the moment no variant has free stock, and that
      // includes stock merely HELD by a checkout in flight.
      //
      // Gating this lookup on ACTIVE alone meant the first buyer to reserve the
      // last unit made the product unreadable — to their own saga, which
      // re-reads the variant to price it and then failed with "no longer
      // available". Two shoppers racing for one unit both lost it, and the unit
      // stayed on the shelf unsold.
      //
      // Whether there is stock to sell is decided by stock, below and in
      // inventory-service. DRAFT, PENDING_APPROVAL, REJECTED and ARCHIVED stay
      // hidden, because those are real delistings.
      product: { status: { in: ['ACTIVE', 'OUT_OF_STOCK'] } },
      ...(productId ? { productId } : {}),
    },
    include: {
      product: {
        select: {
          name: true, slug: true, sellerId: true, currency: true, categoryId: true,
          // The slug, not just the id: tax-service decides zero-rating by
          // category NAME ('food', 'medical', 'agricultural', 'books'), and a
          // cuid matches none of them, so every zero-rated good was being
          // quoted at the standard 18% rate.
          category: { select: { slug: true } },
        },
      },
      attributeValues: {
        include: {
          attribute: { select: { id: true, name: true, slug: true, type: true, unit: true } },
        },
      },
    },
  });

  if (!variant) return null;

  const { product, attributeValues, ...rest } = variant;

  return {
    ...rest,
    // Prisma serialises Decimal as a string over JSON. Consumers coerce with
    // Number() anyway, but emitting a number keeps the contract unambiguous.
    price:          Number(variant.price),
    compareAtPrice: variant.compareAtPrice === null ? null : Number(variant.compareAtPrice),
    availableStock: variant.stock - variant.reserved,
    inStock:        variant.stock - variant.reserved > 0,
    productName:    product.name,
    productSlug:    product.slug,
    sellerId:       product.sellerId,
    // Carried so a category-restricted discount can be decided against what is
    // really being bought. Without it checkout sent no category to
    // discount-service, so such a coupon matched nothing and silently
    // evaluated to zero.
    categoryId:     product.categoryId ?? null,
    categorySlug:   product.category?.slug ?? null,
    currency:       product.currency,
    attributeValues: attributeValues ? attributeValues.map((av) => ({
      id:          av.id,
      attributeId: av.attributeId,
      name:        av.attribute?.name,
      slug:        av.attribute?.slug,
      type:        av.attribute?.type,
      unit:        av.attribute?.unit,
      value:       av.value,
    })) : [],
  };
}

export async function getVariantsByProduct(productId: string) {
  const variants = await prisma.productVariant.findMany({
    where:   { productId, active: true },
    orderBy: { createdAt: 'asc' },
    include: {
      attributeValues: {
        include: {
          attribute: { select: { id: true, name: true, slug: true, type: true, unit: true } },
        },
      },
    },
  });
  // Attach availableStock computed field
  return variants.map((v) => {
    const { attributeValues, ...rest } = v;
    return {
      ...rest,
      price:          Number(v.price),
      compareAtPrice: v.compareAtPrice === null ? null : Number(v.compareAtPrice),
      availableStock: v.stock - v.reserved,
      inStock:        v.stock - v.reserved > 0,
      attributeValues: attributeValues ? attributeValues.map((av) => ({
        id:          av.id,
        attributeId: av.attributeId,
        name:        av.attribute?.name,
        slug:        av.attribute?.slug,
        type:        av.attribute?.type,
        unit:        av.attribute?.unit,
        value:       av.value,
      })) : [],
    };
  });
}

/** Raised when a caller tries to modify a product they do not own. */
export class NotProductOwnerError extends Error {
  readonly status = 403;
  constructor() {
    super('You can only modify variants on products you own.');
    this.name = 'NotProductOwnerError';
  }
}

/** Raised when a variant id does not resolve. Distinct from "not yours". */
export class VariantNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Variant not found');
    this.name = 'VariantNotFoundError';
  }
}

/**
 * Resolve a variant and confirm the caller owns the product it belongs to.
 *
 * `updateVariant` and `deleteVariant` address a variant directly, so unlike
 * `createVariant` there is no productId to check against — ownership has to be
 * reached through the variant's parent. Both mutations call this FIRST, before
 * any write and before `deleteVariant`'s reservation count, so a rejected
 * request leaves the database untouched.
 *
 * Returns the variant so callers that need its columns do not re-query.
 */
async function assertVariantOwnedBy(variantId: string, sellerId: string) {
  const variant = await prisma.productVariant.findUnique({
    where:   { id: variantId },
    include: { product: { select: { sellerId: true, categoryId: true } } },
  });

  if (!variant) throw new VariantNotFoundError();

  if (variant.product.sellerId !== sellerId) {
    // 403, not 404: the variant is visible on the storefront, so denying its
    // existence would be a lie the caller can trivially disprove.
    throw new NotProductOwnerError();
  }

  return variant;
}

/**
 * Validates variant attribute values:
 * 1. Rejects duplicate attribute IDs in payload (422)
 * 2. Resolves category hierarchy and ensures attributes belong to product category or ancestors (422)
 * 3. Enforces that attributes are active (422)
 * 4. Validates value conforming to attribute type definition (422)
 */
async function validateVariantAttributes(
  attributeValues: Array<{ attributeId: string; value: string }>,
  productCategoryId: string | null | undefined,
) {
  // 1. Check for duplicate attribute IDs in request
  const seenIds = new Set<string>();
  for (const av of attributeValues) {
    if (seenIds.has(av.attributeId)) {
      throw Object.assign(
        new Error(`Duplicate attribute ID "${av.attributeId}" in variant attribute values. Each attribute can only be assigned once per variant.`),
        { status: 422 },
      );
    }
    seenIds.add(av.attributeId);
  }

  // 2. Resolve allowed category hierarchy
  let allowedCategoryIds = new Set<string>();
  if (productCategoryId) {
    const ancestorIds = await getCategoryAncestorIds(productCategoryId);
    allowedCategoryIds = new Set(ancestorIds);
  }

  // 3. Validate each attribute against definitions and hierarchy
  for (const av of attributeValues) {
    const attr = await prisma.categoryAttribute.findUnique({
      where: { id: av.attributeId },
    });
    if (!attr) {
      throw Object.assign(new Error(`Category attribute with id "${av.attributeId}" not found`), { status: 404 });
    }
    if (!attr.active) {
      throw Object.assign(
        new Error(`Category attribute "${attr.name}" (${attr.slug}) is inactive and cannot be assigned.`),
        { status: 422 },
      );
    }
    if (!allowedCategoryIds.has(attr.categoryId)) {
      throw Object.assign(
        new Error(`Category attribute "${attr.name}" does not belong to the product's category or any of its ancestors.`),
        { status: 422 },
      );
    }
    const valCheck = validateAttributeValue(attr, av.value);
    if (!valCheck.valid) {
      throw Object.assign(new Error(valCheck.error ?? 'Invalid attribute value'), { status: 422 });
    }
  }
}

/**
 * Add a variant (a purchasable SKU with its own price) to a product.
 *
 * `sellerId` is the authenticated caller, and it is checked against the
 * product's owner. The comment below used to claim this happened; the check
 * itself was never written, and the route is mounted `pub()` at the gateway —
 * so any signed-in customer could add a variant, at any price, to any seller's
 * product. A variant priced at 1 on someone else's listing is a purchase the
 * checkout saga would honour, because it prices from exactly this table.
 */
export async function createVariant(
  productId: string,
  input: z.input<typeof CreateVariantSchema>,
  sellerId: string,
) {
  const validated = CreateVariantSchema.parse(input);

  // Verify product exists and belongs to seller
  const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

  if (product.sellerId !== sellerId) {
    // 403, not 404: the caller is authenticated and the product plainly
    // exists — they simply do not own it.
    throw new NotProductOwnerError();
  }

  const { attributeValues, ...variantFields } = validated;

  // Validate attributeValues if provided
  if (attributeValues && attributeValues.length > 0) {
    await validateVariantAttributes(attributeValues, product.categoryId);
  }

  // Auto-generate SKU if not provided
  const sku = variantFields.sku ?? generateSKU(product.slug, variantFields.attributes);

  const variant = await runTransaction(async (tx) => {
    const v = await tx.productVariant.create({
      data: {
        ...variantFields,
        sku,
        productId,
        price:   variantFields.price,
        stock:   variantFields.stock,
        barcode: variantFields.barcode ?? null,
      },
    });

    if (attributeValues && attributeValues.length > 0 && tx.variantAttributeValue?.createMany) {
      await tx.variantAttributeValue.createMany({
        data: attributeValues.map((av) => ({
          variantId:   v.id,
          attributeId: av.attributeId,
          value:       av.value,
        })),
      });
    }

    return v;
  });

  // A new SKU changes the product's price range, its stock total and whether
  // it is in stock at all. Without this the cached PDP and the search document
  // both keep describing the product as it was before the variant existed.
  await refreshProductProjections(productId);

  return variant;
}

/**
 * Change a variant's attributes, price or stock.
 *
 * Ownership is checked before validation and before the write. This had the
 * same hole `createVariant` did: the route sits under the gateway's `pub()`
 * /products mount, so any signed-in customer could re-price another seller's
 * SKU — and the checkout saga prices from this table, so a variant edited to
 * cost 1 is a purchase the system would honour.
 */
export async function updateVariant(
  variantId: string,
  input: z.input<typeof UpdateVariantSchema>,
  sellerId: string,
) {
  const existingVariant = await assertVariantOwnedBy(variantId, sellerId);

  const validated = UpdateVariantSchema.parse(input);
  const { attributeValues, ...variantFields } = validated;

  if (attributeValues && attributeValues.length > 0) {
    await validateVariantAttributes(attributeValues, existingVariant.product.categoryId);
  }

  const variant = await runTransaction(async (tx) => {
    const v = await tx.productVariant.update({
      where: { id: variantId },
      data:  {
        ...variantFields,
        barcode: variantFields.barcode !== undefined ? (variantFields.barcode ?? null) : undefined,
      },
    });

    if (attributeValues !== undefined && tx.variantAttributeValue) {
      if (tx.variantAttributeValue.deleteMany) {
        await tx.variantAttributeValue.deleteMany({ where: { variantId } });
      }
      if (attributeValues.length > 0 && tx.variantAttributeValue.createMany) {
        await tx.variantAttributeValue.createMany({
          data: attributeValues.map((av) => ({
            variantId,
            attributeId: av.attributeId,
            value:       av.value,
          })),
        });
      }
    }

    return v;
  });

  // The write that made this necessary: a price or stock edit here is what a
  // shopper sees on the PDP and what the index filters on.
  await refreshProductProjections(variant.productId);

  return variant;
}

/**
 * Soft-delete a variant (sets `active: false` — the row is kept so historical
 * orders still resolve their line items).
 *
 * The ownership check runs before the reservation count, not after: a caller
 * who does not own the variant should be refused outright, not told how many
 * carts are holding someone else's stock.
 */
export async function deleteVariant(variantId: string, sellerId: string) {
  await assertVariantOwnedBy(variantId, sellerId);

  // Block deletion if active reservations exist
  const reservations = await prisma.inventoryReservation.count({
    where: { variantId, expiresAt: { gt: new Date() } },
  });
  if (reservations > 0) {
    throw new Error(`Cannot delete variant: ${reservations} active cart reservation(s). Wait for them to expire.`);
  }
  const variant = await prisma.productVariant.update({
    where: { id: variantId },
    data:  { active: false },
  });

  // productInclude only selects active variants, so retiring one changes the
  // product's totals exactly as an edit does.
  await refreshProductProjections(variant.productId);

  return variant;
}
