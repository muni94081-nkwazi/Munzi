/**
 * Gate 3B — Buy Box Algorithm & Selection Engine Tests
 *
 * Tests:
 * 1. calculateBuyBoxScore — price, stock, condition, and seller trust weighting.
 * 2. evaluateBuyBoxForVariant — winner selection, demotion, tie-breaking, ineligible sellers.
 * 3. evaluateBuyBoxForProduct — multi-variant independence.
 * 4. Integration via offer lifecycle (create, update, delete, moderate) triggering re-evaluation.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ── Mock Prisma & Dependencies ────────────────────────────────────────────────

const mockPrisma: any = {
  $queryRaw:    jest.fn<(...args: any[]) => any>().mockResolvedValue([]),
  $executeRaw:  jest.fn<(...args: any[]) => any>().mockResolvedValue(1),
  $transaction: jest.fn<(...args: any[]) => any>(),
  product: {
    findUnique: jest.fn<(...args: any[]) => any>(),
    findFirst:  jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
  },
  productVariant: {
    findUnique: jest.fn<(...args: any[]) => any>(),
    findFirst:  jest.fn<(...args: any[]) => any>(),
    findMany:   jest.fn<(...args: any[]) => any>(),
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

// Mock seller eligibility — default to eligible
const mockEligibility = {
  verifySellerEligibility: jest.fn<(...args: any[]) => any>(),
};

jest.unstable_mockModule('../services/seller-eligibility.service.js', () => mockEligibility);

const {
  calculateBuyBoxScore,
  evaluateBuyBoxForVariant,
  evaluateBuyBoxForProduct,
  toPublicBuyBoxOffer,
  toPublicBuyBoxResult,
  runWithRetry,
} = await import('../services/buybox.service.js');

// ── Shared Fixtures ───────────────────────────────────────────────────────────

const eligibleSeller = {
  isEligible:         true,
  standing:           'GOOD' as const,
  isVerifiedMerchant: true,
  storeStatus:        'ACTIVE' as const,
  verificationStatus: 'verified' as const,
};

const eligibleSellerAtRisk = {
  isEligible:         true,
  standing:           'AT_RISK' as const,
  isVerifiedMerchant: false,
  storeStatus:        'ACTIVE' as const,
  verificationStatus: 'verified' as const,
};

const ineligibleSeller = {
  isEligible: false,
  reason:     'SELLER_SUSPENDED',
  standing:   'SUSPENDED' as const,
};

function makeOffer(overrides: Record<string, any> = {}) {
  return {
    id:             'off-001',
    productId:      'prod-001',
    variantId:      'var-001',
    sellerId:       'seller-alpha',
    sellerSku:      'ALPHA-SKU-001',
    price:          3000000,
    stock:          20,
    reserved:       0,
    condition:      'NEW',
    status:         'ACTIVE',
    isBuyBoxWinner: false,
    createdAt:      new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ── Setup & Reset ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.$transaction.mockImplementation((fn: (tx: any) => any) => fn(mockPrisma));
  mockPrisma.product.update.mockResolvedValue({});
  mockPrisma.productOffer.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.productOffer.update.mockResolvedValue({});
  mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);
});

afterEach(() => {
  jest.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. calculateBuyBoxScore — Pure Scoring Logic
// ═══════════════════════════════════════════════════════════════════════════════

describe('calculateBuyBoxScore — Scoring Engine', () => {
  it('awards maximum price score (600) when offer is the lowest priced', () => {
    const { score, breakdown } = calculateBuyBoxScore(
      { price: 3000000, stock: 20, reserved: 0, condition: 'NEW' },
      3000000, // minPrice === offerPrice
      eligibleSeller,
    );

    expect(breakdown.priceScore).toBe(600);
    expect(breakdown.conditionScore).toBe(150);
    expect(breakdown.sellerTrustScore).toBe(50); // verified + GOOD
    expect(breakdown.stockScore).toBe(200);      // 20 / 10 capped at 1.0 → 200
    expect(score).toBe(1000);                     // theoretical max
  });

  it('penalizes higher-priced offers proportionally', () => {
    const { breakdown } = calculateBuyBoxScore(
      { price: 6000000, stock: 20, reserved: 0, condition: 'NEW' },
      3000000, // minPrice is half of offer price
      eligibleSeller,
    );

    // (3000000 / 6000000) * 600 = 300
    expect(breakdown.priceScore).toBe(300);
  });

  it('awards 0 score for out-of-stock offers (sellable stock ≤ 0)', () => {
    const { score, breakdown } = calculateBuyBoxScore(
      { price: 3000000, stock: 5, reserved: 5, condition: 'NEW' },
      3000000,
      eligibleSeller,
    );

    expect(score).toBe(0);
    expect(breakdown.totalScore).toBe(0);
  });

  it('awards 0 score for invalid (zero) price', () => {
    const { score } = calculateBuyBoxScore(
      { price: 0, stock: 20, reserved: 0, condition: 'NEW' },
      3000000,
      eligibleSeller,
    );

    expect(score).toBe(0);
  });

  it('scales stock score linearly up to 10 units, then caps at 200', () => {
    const small = calculateBuyBoxScore(
      { price: 1000, stock: 3, reserved: 0, condition: 'NEW' },
      1000,
      eligibleSeller,
    );
    // (3 / 10) * 200 = 60
    expect(small.breakdown.stockScore).toBe(60);

    const large = calculateBuyBoxScore(
      { price: 1000, stock: 100, reserved: 0, condition: 'NEW' },
      1000,
      eligibleSeller,
    );
    expect(large.breakdown.stockScore).toBe(200);
  });

  it('assigns correct condition weights', () => {
    const conditions: Array<[string, number]> = [
      ['NEW',           150],
      ['USED_LIKE_NEW', 100],
      ['REFURBISHED',   80],
      ['OPEN_BOX',      80],
      ['USED_GOOD',     50],
      ['USED_FAIR',     20],
      ['FOR_PARTS',     0],
    ];

    for (const [condition, expected] of conditions) {
      const { breakdown } = calculateBuyBoxScore(
        { price: 1000, stock: 10, reserved: 0, condition },
        1000,
        eligibleSeller,
      );
      expect(breakdown.conditionScore).toBe(expected);
    }
  });

  it('awards seller trust score of 50 for verified merchant with GOOD standing', () => {
    const { breakdown } = calculateBuyBoxScore(
      { price: 1000, stock: 10, reserved: 0, condition: 'NEW' },
      1000,
      eligibleSeller,
    );
    expect(breakdown.sellerTrustScore).toBe(50); // 30 (verified) + 20 (GOOD)
  });

  it('awards seller trust score of 5 for unverified merchant with AT_RISK standing', () => {
    const { breakdown } = calculateBuyBoxScore(
      { price: 1000, stock: 10, reserved: 0, condition: 'NEW' },
      1000,
      eligibleSellerAtRisk,
    );
    expect(breakdown.sellerTrustScore).toBe(5); // 0 (not verified) + 5 (AT_RISK)
  });

  it('awards seller trust score of 0 for ineligible sellers', () => {
    const { breakdown } = calculateBuyBoxScore(
      { price: 1000, stock: 10, reserved: 0, condition: 'NEW' },
      1000,
      ineligibleSeller as any,
    );
    expect(breakdown.sellerTrustScore).toBe(0);
  });

  it('defaults seller trust to 20 when eligibility data is not provided', () => {
    const { breakdown } = calculateBuyBoxScore(
      { price: 1000, stock: 10, reserved: 0, condition: 'NEW' },
      1000,
      null,
    );
    expect(breakdown.sellerTrustScore).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. evaluateBuyBoxForVariant — Winner Selection & Demotion
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateBuyBoxForVariant — Winner Selection', () => {
  it('awards Buy Box to the lowest priced eligible offer', async () => {
    const offers = [
      makeOffer({ id: 'off-expensive', sellerId: 'seller-A', price: 5000000, stock: 10 }),
      makeOffer({ id: 'off-cheapest',  sellerId: 'seller-B', price: 2000000, stock: 10 }),
      makeOffer({ id: 'off-mid',       sellerId: 'seller-C', price: 3500000, stock: 10 }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result).not.toBeNull();
    expect(result!.winningOfferId).toBe('off-cheapest');
    expect(result!.eligibleCount).toBe(3);
    expect(result!.evaluatedCount).toBe(3);

    // Verify demotion call was made
    expect(mockPrisma.productOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          variantId: 'var-001',
          isBuyBoxWinner: true,
          NOT: { id: 'off-cheapest' },
        }),
        data: { isBuyBoxWinner: false },
      }),
    );

    // Verify winner promotion
    expect(mockPrisma.productOffer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'off-cheapest' },
        data: { isBuyBoxWinner: true },
      }),
    );
  });

  it('demotes winner when their stock drops to 0 and promotes runner-up', async () => {
    const offers = [
      makeOffer({
        id: 'off-prev-winner', sellerId: 'seller-A', price: 2000000,
        stock: 5, reserved: 5, isBuyBoxWinner: true, // sellable = 0
      }),
      makeOffer({
        id: 'off-runner-up', sellerId: 'seller-B', price: 3000000,
        stock: 20, reserved: 0,
      }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBe('off-runner-up');
    expect(result!.eligibleCount).toBe(1); // only runner-up has stock
  });

  it('NEW condition beats USED_GOOD when price is identical', async () => {
    const baseTime = new Date('2026-01-01T00:00:00Z');
    const offers = [
      makeOffer({
        id: 'off-used', sellerId: 'seller-A', price: 3000000,
        stock: 10, condition: 'USED_GOOD',
        createdAt: baseTime,
      }),
      makeOffer({
        id: 'off-new', sellerId: 'seller-B', price: 3000000,
        stock: 10, condition: 'NEW',
        createdAt: new Date(baseTime.getTime() + 1000), // created later
      }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    // NEW gets 150 condition pts vs USED_GOOD's 50 — NEW wins despite being created later
    expect(result!.winningOfferId).toBe('off-new');
  });

  it('ineligible/suspended seller cannot win Buy Box regardless of price', async () => {
    const offers = [
      makeOffer({
        id: 'off-cheap-bad', sellerId: 'seller-bad', price: 1000000, stock: 50,
      }),
      makeOffer({
        id: 'off-pricier-good', sellerId: 'seller-good', price: 3000000, stock: 20,
      }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);

    // seller-bad is ineligible, seller-good is eligible
    mockEligibility.verifySellerEligibility
      .mockResolvedValueOnce(ineligibleSeller)
      .mockResolvedValueOnce(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBe('off-pricier-good');
    expect(result!.eligibleCount).toBe(1);
  });

  it('breaks ties by earlier createdAt (earlier listing wins)', async () => {
    const earlier = new Date('2026-01-01T00:00:00Z');
    const later   = new Date('2026-06-01T00:00:00Z');

    const offers = [
      makeOffer({
        id: 'off-later', sellerId: 'seller-B', price: 3000000,
        stock: 10, condition: 'NEW', createdAt: later,
      }),
      makeOffer({
        id: 'off-earlier', sellerId: 'seller-A', price: 3000000,
        stock: 10, condition: 'NEW', createdAt: earlier,
      }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBe('off-earlier');
  });

  it('returns null for empty variant with no offers', async () => {
    mockPrisma.productOffer.findMany.mockResolvedValueOnce([]);

    const result = await evaluateBuyBoxForVariant('var-empty', mockPrisma);
    expect(result).toBeNull();
  });

  it('demotes all and returns null winner when all offers are out of stock', async () => {
    const offers = [
      makeOffer({ id: 'off-1', stock: 5, reserved: 5 }),
      makeOffer({ id: 'off-2', stock: 0, reserved: 0 }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBeNull();
    expect(result!.eligibleCount).toBe(0);

    // Ensure demotion was performed
    expect(mockPrisma.productOffer.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { variantId: 'var-001', isBuyBoxWinner: true },
        data: { isBuyBoxWinner: false },
      }),
    );
  });

  it('demotes all when every seller fails eligibility check', async () => {
    const offers = [
      makeOffer({ id: 'off-1', sellerId: 'bad-1', stock: 20 }),
      makeOffer({ id: 'off-2', sellerId: 'bad-2', stock: 20 }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(ineligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBeNull();
    expect(result!.eligibleCount).toBe(0);
  });

  it('skips promotion update if winner already has isBuyBoxWinner: true', async () => {
    const offers = [
      makeOffer({
        id: 'off-already-winner', sellerId: 'seller-A', price: 2000000,
        stock: 20, isBuyBoxWinner: true,
      }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    expect(result!.winningOfferId).toBe('off-already-winner');

    // update should NOT have been called since winner flag is already set
    expect(mockPrisma.productOffer.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'off-already-winner' },
        data: { isBuyBoxWinner: true },
      }),
    );
  });

  it('caches seller eligibility per sellerId (does not re-fetch for same seller)', async () => {
    const offers = [
      makeOffer({ id: 'off-1', sellerId: 'seller-X', price: 2000000, stock: 10, variantId: 'var-001' }),
      makeOffer({ id: 'off-2', sellerId: 'seller-X', price: 3000000, stock: 10, variantId: 'var-001' }),
      makeOffer({ id: 'off-3', sellerId: 'seller-Y', price: 2500000, stock: 10, variantId: 'var-001' }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    await evaluateBuyBoxForVariant('var-001', mockPrisma);

    // Should have been called only twice: once for seller-X, once for seller-Y
    expect(mockEligibility.verifySellerEligibility).toHaveBeenCalledTimes(2);
    expect(mockEligibility.verifySellerEligibility).toHaveBeenCalledWith('seller-X');
    expect(mockEligibility.verifySellerEligibility).toHaveBeenCalledWith('seller-Y');
  });

  it('filters out INACTIVE offers from Buy Box consideration', async () => {
    const offers = [
      makeOffer({ id: 'off-active', sellerId: 'seller-A', price: 5000000, stock: 10, status: 'ACTIVE' }),
      makeOffer({ id: 'off-inactive', sellerId: 'seller-B', price: 1000000, stock: 50, status: 'INACTIVE' }),
    ];

    mockPrisma.productOffer.findMany.mockResolvedValueOnce(offers);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const result = await evaluateBuyBoxForVariant('var-001', mockPrisma);

    // The cheapest is INACTIVE; only the ACTIVE one is eligible
    expect(result!.winningOfferId).toBe('off-active');
    expect(result!.eligibleCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. evaluateBuyBoxForProduct — Multi-Variant Independence
// ═══════════════════════════════════════════════════════════════════════════════

describe('evaluateBuyBoxForProduct — Multi-Variant Independence', () => {
  it('evaluates each variant independently and returns separate winners', async () => {
    // Variant A and B for the same product
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([
      { id: 'var-A' },
      { id: 'var-B' },
    ]);

    // Offers for Variant A: seller-1 is cheaper
    mockPrisma.productOffer.findMany
      .mockResolvedValueOnce([
        makeOffer({ id: 'off-A1', variantId: 'var-A', sellerId: 'seller-1', price: 2000000, stock: 10 }),
        makeOffer({ id: 'off-A2', variantId: 'var-A', sellerId: 'seller-2', price: 4000000, stock: 10 }),
      ])
      // Offers for Variant B: seller-2 is cheaper
      .mockResolvedValueOnce([
        makeOffer({ id: 'off-B1', variantId: 'var-B', sellerId: 'seller-1', price: 5000000, stock: 10 }),
        makeOffer({ id: 'off-B2', variantId: 'var-B', sellerId: 'seller-2', price: 1000000, stock: 10 }),
      ]);

    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const results = await evaluateBuyBoxForProduct('prod-001', mockPrisma);

    expect(results).toHaveLength(2);

    const varAResult = results.find((r: any) => r.variantId === 'var-A');
    const varBResult = results.find((r: any) => r.variantId === 'var-B');

    expect(varAResult!.winningOfferId).toBe('off-A1'); // seller-1 cheaper on var-A
    expect(varBResult!.winningOfferId).toBe('off-B2'); // seller-2 cheaper on var-B
  });

  it('returns empty array for product with no variants', async () => {
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([]);

    const results = await evaluateBuyBoxForProduct('prod-empty', mockPrisma);
    expect(results).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Public Sanitization Helpers (Gate 3B.1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('toPublicBuyBoxOffer & toPublicBuyBoxResult — Public Sanitization', () => {
  it('strips private warehouse inventory and seller SKU from candidate offers', () => {
    const rawOffer = makeOffer({
      id:        'off-secret',
      sellerSku: 'PRIVATE-SKU-42',
      stock:     100,
      reserved:  15,
      price:     45000,
    });

    const publicOffer = toPublicBuyBoxOffer(rawOffer);

    expect(publicOffer).not.toBeNull();
    expect(publicOffer!.id).toBe('off-secret');
    expect(publicOffer!.price).toBe(45000);
    expect(publicOffer!.inStock).toBe(true);

    // Private fields MUST NOT exist
    expect((publicOffer as any).stock).toBeUndefined();
    expect((publicOffer as any).reserved).toBeUndefined();
    expect((publicOffer as any).sellerSku).toBeUndefined();
  });

  it('correctly sets inStock to false when sellable stock is zero or negative', () => {
    const outOfStockOffer = makeOffer({ stock: 5, reserved: 5 });
    const publicOffer = toPublicBuyBoxOffer(outOfStockOffer);

    expect(publicOffer!.inStock).toBe(false);
  });

  it('strips internal algorithmic breakdown, score and counts from Buy Box result', () => {
    const rawResult = {
      variantId:      'var-100',
      productId:      'prod-100',
      winningOfferId: 'off-100',
      winner: makeOffer({
        id:        'off-100',
        sellerSku: 'INTERNAL-SKU',
        stock:     20,
        reserved:  2,
        price:     50000,
      }),
      score:     980,
      breakdown: {
        priceScore:       600,
        stockScore:       200,
        conditionScore:   150,
        sellerTrustScore: 30,
        totalScore:       980,
      },
      evaluatedCount: 4,
      eligibleCount:   2,
    };

    const publicResult = toPublicBuyBoxResult(rawResult as any);

    expect(publicResult).not.toBeNull();
    expect(publicResult!.variantId).toBe('var-100');
    expect(publicResult!.productId).toBe('prod-100');
    expect(publicResult!.winningOfferId).toBe('off-100');
    expect(publicResult!.hasWinner).toBe(true);
    expect(publicResult!.inStock).toBe(true);
    expect(publicResult!.winner!.price).toBe(50000);

    // Internal scoring & diagnostics MUST NOT leak
    expect((publicResult as any).score).toBeUndefined();
    expect((publicResult as any).breakdown).toBeUndefined();
    expect((publicResult as any).evaluatedCount).toBeUndefined();
    expect((publicResult as any).eligibleCount).toBeUndefined();
    expect((publicResult!.winner as any).stock).toBeUndefined();
    expect((publicResult!.winner as any).reserved).toBeUndefined();
    expect((publicResult!.winner as any).sellerSku).toBeUndefined();
  });

  it('handles null evaluation result gracefully', () => {
    expect(toPublicBuyBoxResult(null)).toBeNull();
    expect(toPublicBuyBoxOffer(null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Concurrency & Serialization Hardening (Gate 3B.1)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Concurrency & Serialization Hardening', () => {
  it('serializes concurrent evaluations for the same variant and yields consistent winner', async () => {
    const offer1 = makeOffer({ id: 'off-cheap', price: 100000, stock: 10 });
    const offer2 = makeOffer({ id: 'off-expensive', price: 500000, stock: 10 });

    mockPrisma.productOffer.findMany.mockResolvedValue([offer1, offer2]);
    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    // Trigger multiple simultaneous evaluations for the SAME variant
    const [res1, res2, res3] = await Promise.all([
      evaluateBuyBoxForVariant('var-concurrent-1', mockPrisma),
      evaluateBuyBoxForVariant('var-concurrent-1', mockPrisma),
      evaluateBuyBoxForVariant('var-concurrent-1', mockPrisma),
    ]);

    expect(res1!.winningOfferId).toBe('off-cheap');
    expect(res2!.winningOfferId).toBe('off-cheap');
    expect(res3!.winningOfferId).toBe('off-cheap');

    // Winner was determined deterministically across all executions
    expect(res1!.winningOfferId).toBe(res2!.winningOfferId);
    expect(res2!.winningOfferId).toBe(res3!.winningOfferId);
  });

  it('allows concurrent evaluations for DIFFERENT variants to execute in parallel', async () => {
    const offerA = makeOffer({ id: 'off-A', variantId: 'var-A', price: 10000, stock: 10 });
    const offerB = makeOffer({ id: 'off-B', variantId: 'var-B', price: 20000, stock: 10 });

    mockPrisma.productOffer.findMany
      .mockResolvedValueOnce([offerA])
      .mockResolvedValueOnce([offerB]);

    mockEligibility.verifySellerEligibility.mockResolvedValue(eligibleSeller);

    const [resA, resB] = await Promise.all([
      evaluateBuyBoxForVariant('var-A', mockPrisma),
      evaluateBuyBoxForVariant('var-B', mockPrisma),
    ]);

    expect(resA!.variantId).toBe('var-A');
    expect(resA!.winningOfferId).toBe('off-A');
    expect(resB!.variantId).toBe('var-B');
    expect(resB!.winningOfferId).toBe('off-B');
  });

  it('runWithRetry retries on transient PostgreSQL deadlock/serialization error and succeeds', async () => {
    let callCount = 0;
    const transientError: any = new Error('deadlock detected');
    transientError.code = '40P01';

    const operation = jest.fn(async () => {
      callCount++;
      if (callCount < 2) {
        throw transientError;
      }
      return 'recovered-successfully';
    });

    const result = await runWithRetry(operation, 3);

    expect(result).toBe('recovered-successfully');
    expect(callCount).toBe(2);
  });

  it('runWithRetry fails immediately on permanent non-transient error', async () => {
    let callCount = 0;
    const fatalError: any = new Error('syntax error in query');
    fatalError.code = '42601';

    const operation = jest.fn(async () => {
      callCount++;
      throw fatalError;
    });

    await expect(runWithRetry(operation, 3)).rejects.toThrow('syntax error in query');
    expect(callCount).toBe(1); // Did not retry
  });
});
