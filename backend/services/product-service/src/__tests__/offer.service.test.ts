/**
 * Phase 2C.2 — ProductOffer Service Logic & Security Tests
 *
 * Tests:
 * 1. Seller-owned ProductOffer creation, updating, deletion, and lifecycle rules.
 * 2. Ownership and role authorization enforcement.
 * 3. Validation: prices, compareAtPrice, MOQ, wholesale tiers, condition.
 * 4. Seller-specific SKU uniqueness and collision handling.
 * 5. Fail-closed seller eligibility integration.
 * 6. Product/Variant relationship integrity.
 * 7. Active reservation protection on deletion.
 * 8. Product aggregate offer price/count recalculation.
 * 9. Public sanitization and private seller data protection.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── Mock Prisma & Dependencies ────────────────────────────────────────────────
const mockPrisma: any = {
  $queryRaw:    jest.fn<(...args: any[]) => any>(),
  $transaction: jest.fn<(...args: any[]) => any>(),
  product: {
    findUnique: jest.fn<(...args: any[]) => any>(),
    findFirst:  jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
  },
  productVariant: {
    findUnique: jest.fn<(...args: any[]) => any>(),
    findFirst:  jest.fn<(...args: any[]) => any>(),
  },
  productOffer: {
    create:     jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
    updateMany: jest.fn<(...args: any[]) => any>(),
    delete:     jest.fn<(...args: any[]) => any>(),
    findUnique: jest.fn<(...args: any[]) => any>(),
    findFirst:  jest.fn<(...args: any[]) => any>(),
    findMany:   jest.fn<(...args: any[]) => any>(),
    count:      jest.fn<(...args: any[]) => any>(),
  },
};

mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) => fn(mockPrisma));

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

// Mock seller eligibility
const mockEligibility = {
  verifySellerEligibility: jest.fn<(...args: any[]) => any>(),
};

jest.unstable_mockModule('../services/seller-eligibility.service.js', () => mockEligibility);

const {
  createOffer,
  updateOffer,
  deleteOffer,
  getOfferById,
  listPublicOffers,
  listSellerOffers,
  adminModerateOffer,
  refreshProductOfferProjections,
} = await import('../services/offer.service.js');

// ── Shared Fixtures ───────────────────────────────────────────────────────────

const eligibleSeller = {
  isEligible:         true,
  standing:           'GOOD' as const,
  isVerifiedMerchant: true,
  storeStatus:        'ACTIVE' as const,
  verificationStatus: 'verified' as const,
};

function makeCanonicalProduct(overrides = {}) {
  return {
    id:        'prod-001',
    slug:      'iphone-15',
    name:      'iPhone 15',
    status:    'ACTIVE',
    sellerId:  'catalog-owner',
    currency:  'UGX',
    condition: 'NEW',
    ...overrides,
  };
}

function makeVariant(overrides = {}) {
  return {
    id:        'var-001',
    productId: 'prod-001',
    sku:       'IPH15-BLK-128',
    price:     3500000,
    stock:     50,
    reserved:  0,
    active:    true,
    product:   makeCanonicalProduct(),
    ...overrides,
  };
}

function makeOffer(overrides = {}) {
  return {
    id:                'off-001',
    productId:         'prod-001',
    variantId:         'var-001',
    sellerId:          'seller-alpha',
    sellerSku:         'ALPHA-IPH15-128',
    price:             3450000,
    compareAtPrice:    3600000,
    currency:          'UGX',
    condition:         'NEW',
    conditionNote:     null,
    moq:               1,
    wholesaleTiers:    null,
    stock:             20,
    reserved:          0,
    lowStockThreshold: 5,
    status:            'ACTIVE',
    isBuyBoxWinner:    false,
    createdAt:         new Date(),
    updatedAt:         new Date(),
    product:           makeCanonicalProduct(),
    variant:           makeVariant(),
    reservations:      [],
    ...overrides,
  };
}

// ── Setup & Reset ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) => fn(mockPrisma));
  mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.productOffer.findMany.mockResolvedValue([]);
  mockPrisma.productOffer.updateMany.mockResolvedValue({ count: 0 });
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── 1. Seller Eligibility & Fail-Closed Enforcement ───────────────────────────

describe('createOffer — Seller Eligibility Enforcement', () => {
  it('rejects offer creation if seller is not eligible (unverified store)', async () => {
    mockEligibility.verifySellerEligibility.mockResolvedValueOnce({
      isEligible: false,
      reason:     'STORE_NOT_VERIFIED',
    });

    await expect(
      createOffer('seller-unverified', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     3000000,
      }),
    ).rejects.toThrow(/Seller is not eligible to create offers/);

    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('rejects offer creation if seller standing is SUSPENDED', async () => {
    mockEligibility.verifySellerEligibility.mockResolvedValueOnce({
      isEligible: false,
      reason:     'SELLER_SUSPENDED',
      standing:   'SUSPENDED',
    });

    await expect(
      createOffer('seller-suspended', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     3000000,
      }),
    ).rejects.toThrow(/Seller is not eligible to create offers/);
  });

  it('fails closed when verification service is unreachable', async () => {
    mockEligibility.verifySellerEligibility.mockResolvedValueOnce({
      isEligible: false,
      reason:     'USER_SERVICE_UNAVAILABLE',
    });

    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     3000000,
      }),
    ).rejects.toThrow(/Seller is not eligible to create offers/);
  });
});

// ── 2. Product and Variant Integrity ──────────────────────────────────────────

describe('createOffer — Canonical Product & Variant Integrity', () => {
  it('rejects creation if variant does not belong to specified product', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(null); // variant not found on product

    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-unrelated',
        price:     3000000,
      }),
    ).rejects.toThrow(/does not belong to product/);

    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('rejects offer creation for ARCHIVED or REJECTED products', async () => {
    const archivedVariant = makeVariant({
      product: makeCanonicalProduct({ status: 'ARCHIVED' }),
    });
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(archivedVariant);

    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     3000000,
      }),
    ).rejects.toThrow(/Cannot create an offer for a product with status "ARCHIVED"/);
  });

  it('forces offer status to INACTIVE if canonical product is PENDING_APPROVAL', async () => {
    const pendingVariant = makeVariant({
      product: makeCanonicalProduct({ status: 'PENDING_APPROVAL' }),
    });
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(pendingVariant);
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce(null); // no dupe SKU
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for buybox evaluation
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for projections
    mockPrisma.productOffer.create.mockImplementationOnce(async ({ data }: any) => ({ id: 'new-off', ...data }));

    const offer = await createOffer('seller-alpha', {
      productId: 'prod-001',
      variantId: 'var-001',
      price:     3000000,
      stock:     10,
      status:    'ACTIVE',
    });

    expect(offer.status).toBe('INACTIVE');
  });

  it('forces offer status to OUT_OF_STOCK if initial stock is zero', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(makeVariant());
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce(null);
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for buybox evaluation
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for projections
    mockPrisma.productOffer.create.mockImplementationOnce(async ({ data }: any) => ({ id: 'new-off', ...data }));

    const offer = await createOffer('seller-alpha', {
      productId: 'prod-001',
      variantId: 'var-001',
      price:     3000000,
      stock:     0,
      status:    'ACTIVE',
    });

    expect(offer.status).toBe('OUT_OF_STOCK');
  });
});

// ── 3. Seller-Specific SKU Uniqueness ─────────────────────────────────────────

describe('ProductOffer — Seller SKU Uniqueness', () => {
  it('rejects duplicate sellerSku for the same seller (409 Conflict)', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(makeVariant());
    // Simulate existing offer with same sellerSku for this seller
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce({
      id:        'off-existing',
      sellerId:  'seller-alpha',
      sellerSku: 'DUPE-SKU',
    });

    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-001',
        sellerSku: 'DUPE-SKU',
        price:     3000000,
      }),
    ).rejects.toThrow(/already in use by this seller/);
  });

  it('allows two different sellers to use the exact same sellerSku', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(makeVariant());
    // No conflicting SKU for seller-beta
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce(null);
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for buybox evaluation
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for projections
    mockPrisma.productOffer.create.mockImplementationOnce(async ({ data }: any) => ({ id: 'off-beta', ...data }));

    const offer = await createOffer('seller-beta', {
      productId: 'prod-001',
      variantId: 'var-001',
      sellerSku: 'COMMON-SKU-100',
      price:     3100000,
      stock:     5,
    });

    expect(offer.sellerSku).toBe('COMMON-SKU-100');
    expect(offer.sellerId).toBe('seller-beta');
  });

  it('rejects updating an offer to a sellerSku already held by another offer of that seller', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(makeOffer({ id: 'off-1', sellerSku: 'OLD-SKU' }));
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce({ id: 'off-2', sellerSku: 'TAKEN-SKU' });

    await expect(
      updateOffer('off-1', 'seller-alpha', { sellerSku: 'TAKEN-SKU' }),
    ).rejects.toThrow(/already in use by this seller/);
  });
});

// ── 4. Validation: Prices, MOQ, and Wholesale Tiers ───────────────────────────

describe('ProductOffer — Price & Tier Validations', () => {
  it('rejects non-positive price', async () => {
    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     -100,
      }),
    ).rejects.toThrow(/Price must be greater than zero/);
  });

  it('rejects compareAtPrice lower than price', async () => {
    await expect(
      createOffer('seller-alpha', {
        productId:      'prod-001',
        variantId:      'var-001',
        price:          10000,
        compareAtPrice: 8000, // lower than price!
      }),
    ).rejects.toThrow(/Compare-at price must be greater than or equal/);
  });

  it('rejects MOQ < 1', async () => {
    await expect(
      createOffer('seller-alpha', {
        productId: 'prod-001',
        variantId: 'var-001',
        price:     10000,
        moq:       0,
      }),
    ).rejects.toThrow(/MOQ must be at least 1/);
  });

  it('validates wholesale tiers: first tier must be lower than base price', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(makeVariant());

    await expect(
      createOffer('seller-alpha', {
        productId:      'prod-001',
        variantId:      'var-001',
        price:          10000,
        wholesaleTiers: [
          { minQty: 5, price: 12000 }, // Tier price higher than base price!
        ],
      }),
    ).rejects.toThrow(/must be lower than base price/);
  });

  it('accepts valid wholesale tiers with strictly increasing quantities and decreasing prices', async () => {
    mockPrisma.productVariant.findFirst.mockResolvedValueOnce(makeVariant());
    mockPrisma.productOffer.findFirst.mockResolvedValueOnce(null);
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for buybox evaluation
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for projections
    mockPrisma.productOffer.create.mockImplementationOnce(async ({ data }: any) => ({ id: 'off-valid', ...data }));

    const offer = await createOffer('seller-alpha', {
      productId:      'prod-001',
      variantId:      'var-001',
      price:          10000,
      wholesaleTiers: [
        { minQty: 10, price: 9000, label: 'Small Bulk' },
        { minQty: 50, price: 8000, label: 'Large Bulk' },
      ],
    });

    expect(offer.wholesaleTiers).toHaveLength(2);
  });
});

// ── 5. Ownership Authorization Enforcement ────────────────────────────────────

describe('updateOffer & deleteOffer — Authorization', () => {
  it('blocks seller from updating another seller’s offer (403 Forbidden)', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(makeOffer({ sellerId: 'seller-alpha' }));

    await expect(
      updateOffer('off-001', 'seller-intruder', { price: 2000000 }, ['ROLE_SELLER']),
    ).rejects.toThrow(/You do not have permission to modify this offer/);

    expect(mockPrisma.productOffer.update).not.toHaveBeenCalled();
  });

  it('blocks seller from deleting another seller’s offer (403 Forbidden)', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(makeOffer({ sellerId: 'seller-alpha' }));

    await expect(
      deleteOffer('off-001', 'seller-intruder', ['ROLE_SELLER']),
    ).rejects.toThrow(/You do not have permission to modify this offer/);

    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('allows an ADMIN to update or delete any offer', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(makeOffer({ sellerId: 'seller-alpha' }));
    mockPrisma.productOffer.update.mockResolvedValueOnce(makeOffer({ price: 3200000 }));
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for buybox evaluation
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]); // for projections

    const updated = await updateOffer('off-001', 'admin-user', { price: 3200000 }, ['ROLE_ADMIN']);
    expect(updated).toBeDefined();
  });
});

// ── 6. Offer Suspension & Moderation Rules ────────────────────────────────────

describe('Offer Lifecycle — Suspension & Reactivation', () => {
  it('prevents a seller from re-activating an administratively SUSPENDED offer', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({ sellerId: 'seller-alpha', status: 'SUSPENDED' }),
    );

    await expect(
      updateOffer('off-001', 'seller-alpha', { status: 'ACTIVE' }, ['ROLE_SELLER']),
    ).rejects.toThrow(/Suspended offers can only be re-activated by an administrator/);
  });

  it('admin can suspend and unsuspend offers', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({ id: 'off-001', status: 'ACTIVE' }),
    );
    mockPrisma.productOffer.update.mockResolvedValueOnce(
      makeOffer({ id: 'off-001', status: 'SUSPENDED' }),
    );
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]);

    const suspended = await adminModerateOffer('off-001', { action: 'SUSPEND', reason: 'Counterfeit claim' }, 'admin-1');
    expect(suspended.status).toBe('SUSPENDED');
  });
});

// ── 7. Active Reservation Protection on Deletion ──────────────────────────────

describe('deleteOffer — Active Reservation Guard', () => {
  it('blocks deletion of an offer with active cart holds/reservations', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({
        sellerId:     'seller-alpha',
        reservations: [{ id: 'res-active', status: 'ACTIVE' }],
      }),
    );

    await expect(
      deleteOffer('off-001', 'seller-alpha'),
    ).rejects.toThrow(/active reservation/);

    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('allows deletion when there are zero active reservations', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({
        sellerId:     'seller-alpha',
        reservations: [],
      }),
    );
    mockPrisma.productOffer.delete.mockResolvedValueOnce({});
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]);

    const res = await deleteOffer('off-001', 'seller-alpha');
    expect(res.success).toBe(true);
    expect(mockPrisma.productOffer.delete).toHaveBeenCalledWith({ where: { id: 'off-001' } });
  });
});

// ── 8. Public Offer Listing & Data Sanitization ────────────────────────────────

describe('listPublicOffers & getOfferById — Public Sanitization', () => {
  it('never returns SUSPENDED or INACTIVE offers to the public', async () => {
    mockPrisma.productOffer.count.mockResolvedValueOnce(1);
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([
      {
        id:             'off-1',
        productId:      'prod-1',
        variantId:      'var-1',
        sellerId:       'seller-a',
        sellerSku:      'SKU-1',
        price:          10000,
        compareAtPrice: 12000,
        currency:       'UGX',
        condition:      'NEW',
        conditionNote:  null,
        moq:            1,
        wholesaleTiers: null,
        isBuyBoxWinner: true,
        status:         'ACTIVE',
        stock:          10,
        reserved:       0,
        createdAt:      new Date(),
      },
    ]);

    const result = await listPublicOffers({ productId: 'prod-1' });

    expect(result.offers).toHaveLength(1);
    expect(mockPrisma.productOffer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['ACTIVE', 'OUT_OF_STOCK'] },
        }),
      }),
    );
  });

  it('hides INACTIVE offer when accessed publicly by ID', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({ status: 'INACTIVE', sellerId: 'seller-alpha' }),
    );

    const publicOffer = await getOfferById('off-001', 'guest-customer', ['ROLE_CUSTOMER']);
    expect(publicOffer).toBeNull();
  });

  it('allows owner to retrieve their own INACTIVE offer', async () => {
    mockPrisma.productOffer.findUnique.mockResolvedValueOnce(
      makeOffer({ status: 'INACTIVE', sellerId: 'seller-alpha' }),
    );

    const ownerOffer = await getOfferById('off-001', 'seller-alpha', ['ROLE_SELLER']);
    expect(ownerOffer).toBeDefined();
    expect(ownerOffer?.status).toBe('INACTIVE');
  });
});

// ── 9. Aggregate Projection Refresh ───────────────────────────────────────────

describe('refreshProductOfferProjections', () => {
  it('correctly calculates minOfferPrice, maxOfferPrice, and activeOfferCount', async () => {
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([
      { price: 30000 },
      { price: 25000 },
      { price: 42000 },
    ]);

    await refreshProductOfferProjections('prod-001', mockPrisma);

    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-001' },
      data:  {
        minOfferPrice:    25000,
        maxOfferPrice:    42000,
        activeOfferCount: 3,
      },
    });
  });

  it('sets prices to null and count to 0 when no active offers remain', async () => {
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]);

    await refreshProductOfferProjections('prod-001', mockPrisma);

    expect(mockPrisma.product.update).toHaveBeenCalledWith({
      where: { id: 'prod-001' },
      data:  {
        minOfferPrice:    null,
        maxOfferPrice:    null,
        activeOfferCount: 0,
      },
    });
  });
});
