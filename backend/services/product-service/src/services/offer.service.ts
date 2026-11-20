import { prisma } from '../db/prisma.js';
import { z } from 'zod';
import { validateWholesaleTiers, type WholesaleTier } from '../../../../shared/types/product.types.js';
import { verifySellerEligibility } from './seller-eligibility.service.js';

// ── Custom Errors ─────────────────────────────────────────────────────────────

export class NotOfferOwnerError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have permission to modify this offer.') {
    super(message);
    this.name = 'NotOfferOwnerError';
  }
}

export class OfferNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Product offer not found.') {
    super(message);
    this.name = 'OfferNotFoundError';
  }
}

export class SellerNotEligibleError extends Error {
  readonly status = 403;
  constructor(message = 'Seller is not eligible to create or manage offers.') {
    super(message);
    this.name = 'SellerNotEligibleError';
  }
}

export class DuplicateSellerSkuError extends Error {
  readonly status = 409;
  constructor(message = 'Seller SKU already in use by this seller.') {
    super(message);
    this.name = 'DuplicateSellerSkuError';
  }
}

export class InvalidOfferOperationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidOfferOperationError';
  }
}

// ── Zod Schemas ───────────────────────────────────────────────────────────────

export const ProductConditionEnum = z.enum([
  'NEW',
  'REFURBISHED',
  'USED_LIKE_NEW',
  'USED_GOOD',
  'USED_FAIR',
  'OPEN_BOX',
  'FOR_PARTS',
]);

export const OfferStatusEnum = z.enum([
  'ACTIVE',
  'INACTIVE',
  'OUT_OF_STOCK',
  'SUSPENDED',
]);

export const CreateOfferSchema = z.object({
  productId:         z.string().min(1, 'Product ID is required'),
  variantId:         z.string().min(1, 'Variant ID is required'),
  sellerSku:         z.string().min(1).max(100).optional().nullable(),
  price:             z.number().positive('Price must be greater than zero').finite(),
  compareAtPrice:    z.number().positive().finite().optional().nullable(),
  currency:          z.string().min(3).max(3).default('UGX'),
  condition:         ProductConditionEnum.default('NEW'),
  conditionNote:     z.string().max(500).optional().nullable(),
  moq:               z.number().int().min(1, 'MOQ must be at least 1').default(1),
  wholesaleTiers:    z.any().optional().nullable(),
  stock:             z.number().int().min(0, 'Stock cannot be negative').default(0),
  lowStockThreshold: z.number().int().min(0).default(5),
  status:            OfferStatusEnum.optional().default('ACTIVE'),
}).refine(
  (data) => {
    if (data.compareAtPrice !== null && data.compareAtPrice !== undefined) {
      return data.compareAtPrice >= data.price;
    }
    return true;
  },
  {
    message: 'Compare-at price must be greater than or equal to the selling price.',
    path:    ['compareAtPrice'],
  },
);

export const UpdateOfferSchema = z.object({
  sellerSku:         z.string().min(1).max(100).optional().nullable(),
  price:             z.number().positive('Price must be greater than zero').finite().optional(),
  compareAtPrice:    z.number().positive().finite().optional().nullable(),
  currency:          z.string().min(3).max(3).optional(),
  condition:         ProductConditionEnum.optional(),
  conditionNote:     z.string().max(500).optional().nullable(),
  moq:               z.number().int().min(1, 'MOQ must be at least 1').optional(),
  wholesaleTiers:    z.any().optional().nullable(),
  stock:             z.number().int().min(0, 'Stock cannot be negative').optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  status:            OfferStatusEnum.optional(),
}).refine(
  (data) => {
    if (data.compareAtPrice !== null && data.compareAtPrice !== undefined && data.price !== undefined) {
      return data.compareAtPrice >= data.price;
    }
    return true;
  },
  {
    message: 'Compare-at price must be greater than or equal to the selling price.',
    path:    ['compareAtPrice'],
  },
);

export const AdminModerateOfferSchema = z.object({
  action: z.enum(['SUSPEND', 'UNSUSPEND']),
  reason: z.string().min(3, 'Reason must be at least 3 characters long'),
});

export type CreateOfferInput = z.input<typeof CreateOfferSchema>;
export type UpdateOfferInput = z.input<typeof UpdateOfferSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAdmin(roles?: string[]): boolean {
  if (!roles || !Array.isArray(roles)) return false;
  return roles.includes('ROLE_ADMIN') || roles.includes('ROLE_SUPER_ADMIN');
}

/**
 * Recalculate and update aggregated offer pricing and count on the canonical Product.
 */
export async function refreshProductOfferProjections(productId: string, client: any = prisma): Promise<void> {
  const activeOffers = await client.productOffer.findMany({
    where: {
      productId,
      status: 'ACTIVE',
    },
    select: {
      price: true,
    },
  });

  const activeCount = activeOffers.length;
  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  if (activeCount > 0) {
    const prices = activeOffers.map((o: { price: any }) => Number(o.price));
    minPrice = Math.min(...prices);
    maxPrice = Math.max(...prices);
  }

  await client.product.update({
    where: { id: productId },
    data: {
      minOfferPrice: minPrice !== null ? minPrice : null,
      maxOfferPrice: maxPrice !== null ? maxPrice : null,
      activeOfferCount: activeCount,
    },
  });
}

// ── Offer Service Methods ─────────────────────────────────────────────────────

/**
 * Create a new seller-owned ProductOffer.
 *
 * Enforces:
 * 1. Fail-closed seller eligibility verification via authoritative service integration.
 * 2. Referential integrity: Variant must belong to specified canonical Product.
 * 3. Product lifecycle check: cannot list offers for ARCHIVED or REJECTED products.
 * 4. Seller SKU uniqueness: [sellerId, sellerSku] must be unique.
 * 5. Wholesale tiers validation: strictly increasing quantities, strictly decreasing prices.
 * 6. Offer status safety: cannot be ACTIVE if Product is not ACTIVE or sellable stock <= 0.
 * 7. Aggregation update: automatically updates Product.minOfferPrice, maxOfferPrice, activeOfferCount.
 */
export async function createOffer(
  sellerId: string,
  input: CreateOfferInput,
  actorRoles?: string[],
) {
  const validated = CreateOfferSchema.parse(input);

  // 1. Verify seller eligibility (fail-closed)
  const eligibility = await verifySellerEligibility(sellerId);
  if (!eligibility.isEligible) {
    throw new SellerNotEligibleError(`Seller is not eligible to create offers: ${eligibility.reason ?? 'UNKNOWN'}`);
  }

  // 2. Validate canonical Product and Variant relationship
  const variant = await prisma.productVariant.findFirst({
    where: {
      id:        validated.variantId,
      productId: validated.productId,
    },
    include: {
      product: true,
    },
  });

  if (!variant || !variant.product) {
    throw new InvalidOfferOperationError(`Variant "${validated.variantId}" does not belong to product "${validated.productId}".`);
  }

  const product = variant.product;
  if (product.status === 'ARCHIVED' || product.status === 'REJECTED') {
    throw new InvalidOfferOperationError(`Cannot create an offer for a product with status "${product.status}".`);
  }

  // 3. Wholesale Tiers Validation
  let validatedWholesaleTiers: WholesaleTier[] | undefined = undefined;
  if (validated.wholesaleTiers) {
    const tiersResult = validateWholesaleTiers(validated.wholesaleTiers, validated.price);
    if (!tiersResult.valid) {
      throw new InvalidOfferOperationError(tiersResult.error ?? 'Invalid wholesale tiers configuration.');
    }
    validatedWholesaleTiers = tiersResult.data;
  }

  // 4. Seller SKU Uniqueness Check
  let sellerSku = validated.sellerSku?.trim() || null;
  if (sellerSku) {
    const existingSku = await prisma.productOffer.findFirst({
      where: {
        sellerId,
        sellerSku,
      },
    });
    if (existingSku) {
      throw new DuplicateSellerSkuError(`Seller SKU "${sellerSku}" is already in use by this seller.`);
    }
  }

  // 5. Initial Status Calculation
  let targetStatus = validated.status ?? 'ACTIVE';
  if (targetStatus === 'ACTIVE') {
    if (product.status !== 'ACTIVE' || !variant.active) {
      targetStatus = 'INACTIVE';
    } else if (validated.stock <= 0) {
      targetStatus = 'OUT_OF_STOCK';
    }
  }

  // 6. Transactional Creation and Aggregate Projection Refresh
  const runner = typeof (prisma as any).$transaction === 'function'
    ? (fn: (tx: any) => Promise<any>) => (prisma as any).$transaction(fn)
    : (fn: (tx: any) => Promise<any>) => fn(prisma);

  const offer = await runner(async (tx: any) => {
    const created = await tx.productOffer.create({
      data: {
        productId:         validated.productId,
        variantId:         validated.variantId,
        sellerId,
        sellerSku,
        price:             validated.price,
        compareAtPrice:    validated.compareAtPrice ?? null,
        currency:          validated.currency,
        condition:         validated.condition,
        conditionNote:     validated.conditionNote ?? null,
        moq:               validated.moq,
        wholesaleTiers:    validatedWholesaleTiers ? (validatedWholesaleTiers as any) : undefined,
        stock:             validated.stock,
        reserved:          0,
        lowStockThreshold: validated.lowStockThreshold,
        status:            targetStatus,
        isBuyBoxWinner:    false,
      },
    });

    await refreshProductOfferProjections(validated.productId, tx);
    return created;
  });

  return offer;
}

/**
 * Update an existing ProductOffer.
 *
 * Enforces:
 * 1. Ownership check: Only the owning seller or admin can update the offer.
 * 2. Suspension lock: Suspended offers cannot be re-activated by sellers.
 * 3. SKU uniqueness: Changing sellerSku must not collide with existing SKUs for this seller.
 * 4. Stock and Status sync: Sellable stock depletion transitions ACTIVE to OUT_OF_STOCK.
 */
export async function updateOffer(
  offerId: string,
  sellerId: string,
  input: UpdateOfferInput,
  actorRoles?: string[],
) {
  const validated = UpdateOfferSchema.parse(input);

  const existing = await prisma.productOffer.findUnique({
    where: { id: offerId },
    include: {
      product: true,
      variant: true,
    },
  });

  if (!existing) {
    throw new OfferNotFoundError();
  }

  // 1. Authorization Check
  if (!isAdmin(actorRoles) && existing.sellerId !== sellerId) {
    throw new NotOfferOwnerError();
  }

  // 2. Suspension Lock
  if (existing.status === 'SUSPENDED' && !isAdmin(actorRoles)) {
    if (validated.status && validated.status !== 'SUSPENDED') {
      throw new InvalidOfferOperationError('Suspended offers can only be re-activated by an administrator.');
    }
  }

  // 3. Wholesale Tiers Validation
  const effectivePrice = validated.price ?? Number(existing.price);
  let validatedWholesaleTiers = existing.wholesaleTiers;
  if (validated.wholesaleTiers !== undefined) {
    if (validated.wholesaleTiers === null) {
      validatedWholesaleTiers = null;
    } else {
      const tiersResult = validateWholesaleTiers(validated.wholesaleTiers, effectivePrice);
      if (!tiersResult.valid) {
        throw new InvalidOfferOperationError(tiersResult.error ?? 'Invalid wholesale tiers configuration.');
      }
      validatedWholesaleTiers = tiersResult.data as any;
    }
  }

  // 4. Seller SKU Uniqueness Check
  let newSellerSku = validated.sellerSku !== undefined ? (validated.sellerSku?.trim() || null) : existing.sellerSku;
  if (newSellerSku && newSellerSku !== existing.sellerSku) {
    const duplicate = await prisma.productOffer.findFirst({
      where: {
        sellerId: existing.sellerId,
        sellerSku: newSellerSku,
        NOT: { id: offerId },
      },
    });
    if (duplicate) {
      throw new DuplicateSellerSkuError(`Seller SKU "${newSellerSku}" is already in use by this seller.`);
    }
  }

  // 5. Status and Stock Reconciliation
  const effectiveStock = validated.stock !== undefined ? validated.stock : existing.stock;
  const sellableStock = effectiveStock - existing.reserved;
  let targetStatus = validated.status ?? existing.status;

  if (targetStatus === 'ACTIVE') {
    if (existing.product.status !== 'ACTIVE' || !existing.variant.active) {
      targetStatus = 'INACTIVE';
    } else if (sellableStock <= 0) {
      targetStatus = 'OUT_OF_STOCK';
    }
  } else if (targetStatus === 'OUT_OF_STOCK' && sellableStock > 0 && validated.status === undefined) {
    // Auto-restock transition if not explicitly set to INACTIVE/SUSPENDED
    if (existing.product.status === 'ACTIVE' && existing.variant.active) {
      targetStatus = 'ACTIVE';
    }
  }

  const runner = typeof (prisma as any).$transaction === 'function'
    ? (fn: (tx: any) => Promise<any>) => (prisma as any).$transaction(fn)
    : (fn: (tx: any) => Promise<any>) => fn(prisma);

  const updated = await runner(async (tx: any) => {
    const u = await tx.productOffer.update({
      where: { id: offerId },
      data: {
        sellerSku:         newSellerSku,
        price:             validated.price !== undefined ? validated.price : undefined,
        compareAtPrice:    validated.compareAtPrice !== undefined ? validated.compareAtPrice : undefined,
        currency:          validated.currency ?? undefined,
        condition:         validated.condition ?? undefined,
        conditionNote:     validated.conditionNote !== undefined ? validated.conditionNote : undefined,
        moq:               validated.moq ?? undefined,
        wholesaleTiers:    validatedWholesaleTiers !== undefined ? validatedWholesaleTiers : undefined,
        stock:             validated.stock !== undefined ? validated.stock : undefined,
        lowStockThreshold: validated.lowStockThreshold ?? undefined,
        status:            targetStatus,
      },
    });

    await refreshProductOfferProjections(existing.productId, tx);
    return u;
  });

  return updated;
}

/**
 * Retrieve a single ProductOffer by ID.
 * Returns public view for guest/customer callers; full view for owner or admin.
 */
export async function getOfferById(offerId: string, actorId?: string, actorRoles?: string[]) {
  const offer = await prisma.productOffer.findUnique({
    where: { id: offerId },
    include: {
      product: {
        select: {
          id:     true,
          name:   true,
          slug:   true,
          status: true,
        },
      },
      variant: {
        select: {
          id:         true,
          sku:        true,
          attributes: true,
          active:     true,
        },
      },
    },
  });

  if (!offer) return null;

  const isOwner = Boolean(actorId && offer.sellerId === actorId);
  const admin = isAdmin(actorRoles);

  // Non-owner / non-admin cannot view INACTIVE or SUSPENDED offers
  if (!isOwner && !admin) {
    if (offer.status === 'INACTIVE' || offer.status === 'SUSPENDED') {
      return null;
    }
  }

  if (isOwner || admin) {
    return offer;
  }

  // Public Sanitized Representation
  return {
    id:             offer.id,
    productId:      offer.productId,
    variantId:      offer.variantId,
    sellerId:       offer.sellerId,
    sellerSku:      offer.sellerSku,
    price:          offer.price,
    compareAtPrice: offer.compareAtPrice,
    currency:       offer.currency,
    condition:      offer.condition,
    conditionNote:  offer.conditionNote,
    moq:            offer.moq,
    wholesaleTiers: offer.wholesaleTiers,
    isBuyBoxWinner: offer.isBuyBoxWinner,
    status:         offer.status,
    isInStock:      (offer.stock - offer.reserved) > 0,
    createdAt:      offer.createdAt,
    updatedAt:      offer.updatedAt,
  };
}

/**
 * Public listing of offers for a canonical product or variant.
 * Filtered to ACTIVE offers (or OUT_OF_STOCK). Never leaks SUSPENDED/INACTIVE.
 */
export async function listPublicOffers(params: {
  productId:   string;
  variantId?:  string;
  condition?:  string;
  minPrice?:   number;
  maxPrice?:   number;
  page?:       number;
  limit?:      number;
  sort?:       'price_asc' | 'price_desc' | 'newest';
}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: any = {
    productId: params.productId,
    status:    { in: ['ACTIVE', 'OUT_OF_STOCK'] },
  };

  if (params.variantId) {
    where.variantId = params.variantId;
  }

  if (params.condition) {
    where.condition = params.condition;
  }

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.price = {};
    if (params.minPrice !== undefined) where.price.gte = params.minPrice;
    if (params.maxPrice !== undefined) where.price.lte = params.maxPrice;
  }

  let orderBy: any = [{ isBuyBoxWinner: 'desc' }, { price: 'asc' }];
  if (params.sort === 'price_desc') {
    orderBy = [{ price: 'desc' }];
  } else if (params.sort === 'newest') {
    orderBy = [{ createdAt: 'desc' }];
  }

  const [total, offers] = await Promise.all([
    prisma.productOffer.count({ where }),
    prisma.productOffer.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id:             true,
        productId:      true,
        variantId:      true,
        sellerId:       true,
        sellerSku:      true,
        price:          true,
        compareAtPrice: true,
        currency:       true,
        condition:      true,
        conditionNote:  true,
        moq:            offerMoq(),
        wholesaleTiers: true,
        isBuyBoxWinner: true,
        status:         true,
        stock:          true,
        reserved:       true,
        createdAt:      true,
      },
    }),
  ]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    offers: offers.map((o: any) => ({
      id:             o.id,
      productId:      o.productId,
      variantId:      o.variantId,
      sellerId:       o.sellerId,
      sellerSku:      o.sellerSku,
      price:          o.price,
      compareAtPrice: o.compareAtPrice,
      currency:       o.currency,
      condition:      o.condition,
      conditionNote:  o.conditionNote,
      moq:            o.moq,
      wholesaleTiers: o.wholesaleTiers,
      isBuyBoxWinner: o.isBuyBoxWinner,
      status:         o.status,
      isInStock:      (o.stock - o.reserved) > 0,
      createdAt:      o.createdAt,
    })),
  };
}

function offerMoq(): true {
  return true;
}

/**
 * List offers belonging to the authenticated seller.
 */
export async function listSellerOffers(
  sellerId: string,
  params: {
    status?:    string;
    productId?: string;
    search?:    string;
    page?:      number;
    limit?:     number;
  },
) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: any = { sellerId };

  if (params.status) {
    where.status = params.status;
  }
  if (params.productId) {
    where.productId = params.productId;
  }
  if (params.search) {
    where.sellerSku = { contains: params.search, mode: 'insensitive' };
  }

  const [total, offers] = await Promise.all([
    prisma.productOffer.count({ where }),
    prisma.productOffer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        product: {
          select: {
            id:     true,
            name:   true,
            slug:   true,
            status: true,
          },
        },
        variant: {
          select: {
            id:         true,
            sku:        true,
            attributes: true,
          },
        },
      },
    }),
  ]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    offers,
  };
}

/**
 * Admin list all offers across all sellers with filtering.
 */
export async function listAdminOffers(params: {
  status?:    string;
  sellerId?:  string;
  productId?: string;
  page?:      number;
  limit?:     number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(50, Math.max(1, params.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params.status)    where.status = params.status;
  if (params.sellerId)  where.sellerId = params.sellerId;
  if (params.productId) where.productId = params.productId;

  const [total, offers] = await Promise.all([
    prisma.productOffer.count({ where }),
    prisma.productOffer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        product: { select: { id: true, name: true, slug: true } },
        variant: { select: { id: true, sku: true, attributes: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    offers,
  };
}

/**
 * Admin action to suspend or unsuspend a seller's offer.
 */
export async function adminModerateOffer(
  offerId: string,
  input: { action: 'SUSPEND' | 'UNSUSPEND'; reason: string },
  adminId: string,
) {
  const validated = AdminModerateOfferSchema.parse(input);

  const offer = await prisma.productOffer.findUnique({
    where: { id: offerId },
  });

  if (!offer) {
    throw new OfferNotFoundError();
  }

  let nextStatus: 'SUSPENDED' | 'ACTIVE' | 'INACTIVE' = 'SUSPENDED';
  if (validated.action === 'UNSUSPEND') {
    nextStatus = (offer.stock - offer.reserved) > 0 ? 'ACTIVE' : 'INACTIVE';
  }

  const runner = typeof (prisma as any).$transaction === 'function'
    ? (fn: (tx: any) => Promise<any>) => (prisma as any).$transaction(fn)
    : (fn: (tx: any) => Promise<any>) => fn(prisma);

  const updated = await runner(async (tx: any) => {
    const res = await tx.productOffer.update({
      where: { id: offerId },
      data: {
        status: nextStatus,
      },
    });

    await refreshProductOfferProjections(offer.productId, tx);
    return res;
  });

  return updated;
}

/**
 * Delete a ProductOffer.
 * Blocks deletion if active reservations exist against the offer.
 */
export async function deleteOffer(offerId: string, sellerId: string, actorRoles?: string[]) {
  const offer = await prisma.productOffer.findUnique({
    where: { id: offerId },
    include: {
      reservations: {
        where: { status: 'ACTIVE' },
      },
    },
  });

  if (!offer) {
    throw new OfferNotFoundError();
  }

  if (!isAdmin(actorRoles) && offer.sellerId !== sellerId) {
    throw new NotOfferOwnerError();
  }

  if (offer.reservations && offer.reservations.length > 0) {
    throw new InvalidOfferOperationError(`Cannot delete offer "${offerId}": it has ${offer.reservations.length} active reservation(s).`);
  }

  const runner = typeof (prisma as any).$transaction === 'function'
    ? (fn: (tx: any) => Promise<any>) => (prisma as any).$transaction(fn)
    : (fn: (tx: any) => Promise<any>) => fn(prisma);

  await runner(async (tx: any) => {
    await tx.productOffer.delete({
      where: { id: offerId },
    });

    await refreshProductOfferProjections(offer.productId, tx);
  });

  return { success: true };
}
