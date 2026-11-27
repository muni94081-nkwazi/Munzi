import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mockVerifySellerEligibility = jest.fn<any>();

jest.unstable_mockModule('../services/seller-eligibility.service.js', () => ({
  verifySellerEligibility: mockVerifySellerEligibility,
}));

const {
  evaluateBuyBoxForVariant,
  toPublicBuyBoxOffer,
  toPublicBuyBoxResult,
} = await import('../services/buybox.service.js');
const { activateBuyBoxAndRefreshProjections } = await import(
  '../services/buybox-activation.service.js'
);

function createMockDb(initialState: {
  products: Array<any>;
  variants: Array<any>;
  offers: Array<any>;
}) {
  const products = initialState.products.map((p) => ({ ...p }));
  const variants = initialState.variants.map((v) => ({ ...v }));
  const offers = initialState.offers.map((o) => ({ ...o }));

  const db: any = {
    $executeRaw: jest.fn(async () => 1),
    $queryRaw: jest.fn(async () => [{ id: 'locked' }]),
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(db),
    productVariant: {
      findMany: jest.fn(async (args?: any) => {
        let list = [...variants].sort((a, b) => a.id.localeCompare(b.id));
        if (args?.cursor?.id) {
          const idx = list.findIndex((v) => v.id === args.cursor.id);
          list = idx >= 0 ? list.slice(idx + (args.skip ?? 0)) : [];
        }
        if (args?.take) list = list.slice(0, args.take);
        return list;
      }),
    },
    product: {
      findMany: jest.fn(async (args?: any) => {
        let list = [...products].sort((a, b) => a.id.localeCompare(b.id));
        if (args?.cursor?.id) {
          const idx = list.findIndex((p) => p.id === args.cursor.id);
          list = idx >= 0 ? list.slice(idx + (args.skip ?? 0)) : [];
        }
        if (args?.take) list = list.slice(0, args.take);
        return list;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const p = products.find((x) => x.id === where.id);
        if (p) Object.assign(p, data);
        return p;
      }),
    },
    productOffer: {
      findMany: jest.fn(async ({ where }: any) => {
        return offers.filter((o) => {
          if (where?.variantId && o.variantId !== where.variantId) return false;
          if (where?.productId && o.productId !== where.productId) return false;
          if (where?.status && o.status !== where.status) return false;
          return true;
        });
      }),
      count: jest.fn(async ({ where }: any) => {
        return offers.filter((o) => {
          if (where?.productId && o.productId !== where.productId) return false;
          if (where?.status && o.status !== where.status) return false;
          return true;
        }).length;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const o of offers) {
          if (where?.variantId && o.variantId !== where.variantId) continue;
          if (where?.isBuyBoxWinner !== undefined && o.isBuyBoxWinner !== where.isBuyBoxWinner) continue;
          if (where?.NOT?.id && o.id === where.NOT.id) continue;
          Object.assign(o, data);
          count++;
        }
        return { count };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const o = offers.find((x) => x.id === where.id);
        if (o) Object.assign(o, data);
        return o;
      }),
    },
    _state: { products, variants, offers },
  };

  return db;
}

describe('Gate 3G.3 — Buy Box Activation, Projections & Schema Alignment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifySellerEligibility.mockImplementation(async (sellerId: string) => {
      if (sellerId === 'seller-suspended') {
        return { isEligible: false, standing: 'SUSPENDED', reason: 'SELLER_SUSPENDED' };
      }
      return {
        isEligible: true,
        standing: 'GOOD',
        isVerifiedMerchant: true,
        storeStatus: 'ACTIVE',
        verificationStatus: 'verified',
      };
    });
  });

  it('selects eligible Buy Box winner, excludes suspended/inactive/zero-stock offers, and refreshes projections idempotently', async () => {
    const db = createMockDb({
      products: [
        { id: 'prod-1', minOfferPrice: null, maxOfferPrice: null, activeOfferCount: 0 },
        { id: 'prod-2', minOfferPrice: 999, maxOfferPrice: 999, activeOfferCount: 5 },
      ],
      variants: [
        { id: 'var-1', productId: 'prod-1' },
        { id: 'var-2', productId: 'prod-2' },
      ],
      offers: [
        {
          id: 'off-1',
          productId: 'prod-1',
          variantId: 'var-1',
          sellerId: 'seller-suspended',
          sellerSku: 'SKU-SUSP',
          price: 1000,
          stock: 10,
          reserved: 0,
          condition: 'NEW',
          status: 'ACTIVE',
          isBuyBoxWinner: true, // stale winner that must be demoted
          createdAt: new Date('2026-11-01T00:00:00Z'),
        },
        {
          id: 'off-2',
          productId: 'prod-1',
          variantId: 'var-1',
          sellerId: 'seller-good',
          sellerSku: 'SKU-GOOD',
          price: 1500,
          stock: 20,
          reserved: 2,
          condition: 'NEW',
          status: 'ACTIVE',
          isBuyBoxWinner: false,
          createdAt: new Date('2026-11-02T00:00:00Z'),
        },
        {
          id: 'off-3',
          productId: 'prod-2',
          variantId: 'var-2',
          sellerId: 'seller-good',
          sellerSku: 'SKU-INACT',
          price: 500,
          stock: 0,
          reserved: 0,
          condition: 'NEW',
          status: 'OUT_OF_STOCK',
          isBuyBoxWinner: true, // stale winner on out-of-stock offer
          createdAt: new Date('2026-11-01T00:00:00Z'),
        },
      ],
    });

    const first = await activateBuyBoxAndRefreshProjections({ dryRun: false, batchSize: 1, client: db });
    expect(first.scannedVariants).toBe(2);
    expect(first.winnersAssigned).toBe(1);
    expect(first.variantsWithoutWinner).toBe(1);
    expect(first.winningOfferIds).toEqual(['off-2']);
    expect(first.productsWithActiveOffers).toBe(1);
    expect(first.productsWithoutActiveOffers).toBe(1);

    // Verify stale winners were demoted and only off-2 won
    expect(db._state.offers.find((o: any) => o.id === 'off-1').isBuyBoxWinner).toBe(false);
    expect(db._state.offers.find((o: any) => o.id === 'off-2').isBuyBoxWinner).toBe(true);
    expect(db._state.offers.find((o: any) => o.id === 'off-3').isBuyBoxWinner).toBe(false);

    // Verify prices, stock, reserved, sellerId were never mutated
    expect(db._state.offers.find((o: any) => o.id === 'off-2')).toMatchObject({
      price: 1500,
      stock: 20,
      reserved: 2,
      sellerId: 'seller-good',
    });

    // Verify prod-1 projections and prod-2 empty projections
    expect(db._state.products.find((p: any) => p.id === 'prod-1')).toMatchObject({
      minOfferPrice: 1000,
      maxOfferPrice: 1500,
      activeOfferCount: 2,
    });
    expect(db._state.products.find((p: any) => p.id === 'prod-2')).toMatchObject({
      minOfferPrice: null,
      maxOfferPrice: null,
      activeOfferCount: 0,
    });

    // Idempotency rerun
    const second = await activateBuyBoxAndRefreshProjections({ dryRun: false, batchSize: 1, client: db });
    expect(second).toEqual(first);
  });

  it('serializes concurrent Buy Box recalculations for the same variant', async () => {
    const db = createMockDb({
      products: [{ id: 'prod-1' }],
      variants: [{ id: 'var-concurrent', productId: 'prod-1' }],
      offers: [
        {
          id: 'off-c1',
          productId: 'prod-1',
          variantId: 'var-concurrent',
          sellerId: 'seller-good',
          sellerSku: 'SKU-C1',
          price: 2000,
          stock: 10,
          reserved: 0,
          condition: 'NEW',
          status: 'ACTIVE',
          isBuyBoxWinner: false,
          createdAt: new Date('2026-11-01T00:00:00Z'),
        },
      ],
    });

    const [r1, r2] = await Promise.all([
      evaluateBuyBoxForVariant('var-concurrent', db),
      evaluateBuyBoxForVariant('var-concurrent', db),
    ]);

    expect(r1?.winningOfferId).toBe('off-c1');
    expect(r2?.winningOfferId).toBe('off-c1');
    expect(db._state.offers[0].isBuyBoxWinner).toBe(true);
  });

  it('sanitizes public Buy Box responses and strips internal scores, reserved quantities, and sellerSku', () => {
    const rawOffer = {
      id: 'off-pub',
      productId: 'prod-1',
      variantId: 'var-1',
      sellerId: 'seller-1',
      sellerSku: 'INTERNAL-SKU-SECRET',
      price: 25000,
      compareAtPrice: 30000,
      currency: 'UGX',
      condition: 'NEW',
      conditionNote: null,
      moq: 1,
      wholesaleTiers: null,
      stock: 12,
      reserved: 4,
      isBuyBoxWinner: true,
      createdAt: '2026-11-27T00:00:00Z',
    };

    const publicOffer = toPublicBuyBoxOffer(rawOffer);
    expect(publicOffer).not.toBeNull();
    expect(publicOffer!.inStock).toBe(true);
    expect((publicOffer as any).reserved).toBeUndefined();
    expect((publicOffer as any).stock).toBeUndefined();
    expect((publicOffer as any).sellerSku).toBeUndefined();

    const publicResult = toPublicBuyBoxResult({
      variantId: 'var-1',
      productId: 'prod-1',
      winningOfferId: 'off-pub',
      winner: rawOffer,
      score: 980,
      breakdown: {
        priceScore: 600,
        stockScore: 200,
        conditionScore: 150,
        sellerTrustScore: 30,
        totalScore: 980,
      },
      evaluatedCount: 3,
      eligibleCount: 2,
    });

    expect(publicResult).not.toBeNull();
    expect(publicResult!.hasWinner).toBe(true);
    expect((publicResult as any).score).toBeUndefined();
    expect((publicResult as any).breakdown).toBeUndefined();
    expect((publicResult as any).evaluatedCount).toBeUndefined();
    expect((publicResult as any).eligibleCount).toBeUndefined();
  });

  it('includes non-destructive additive index migration for Product_status_minOfferPrice_idx', () => {
    const migrationPath = path.resolve(
      __dirname,
      '../../prisma/migrations/20261127000000_product_min_offer_price_idx/migration.sql',
    );
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "Product_status_minOfferPrice_idx" ON "Product"("status", "minOfferPrice");');
    expect(sql.toUpperCase()).not.toContain('DROP ');
    expect(sql.toUpperCase()).not.toContain('TRUNCATE ');
  });

  it('keeps ProductCondition enum identical between product-service and inventory-service schemas', () => {
    const productSchema = fs.readFileSync(
      path.resolve(__dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const inventorySchema = fs.readFileSync(
      path.resolve(__dirname, '../../../inventory-service/prisma/schema.prisma'),
      'utf8',
    );

    const extractEnum = (schema: string) => {
      const match = schema.match(/enum ProductCondition \{([\s\S]*?)\}/);
      expect(match).not.toBeNull();
      return match![1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//'));
    };

    const productValues = extractEnum(productSchema);
    const inventoryValues = extractEnum(inventorySchema);

    expect(productValues).toEqual([
      'NEW',
      'REFURBISHED',
      'USED_LIKE_NEW',
      'USED_GOOD',
      'USED_FAIR',
      'OPEN_BOX',
      'FOR_PARTS',
    ]);
    expect(inventoryValues).toEqual(productValues);
  });
});
