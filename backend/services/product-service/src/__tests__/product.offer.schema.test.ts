/**
 * Phase 2C.1 — ProductOffer Schema & Backfill Unit Tests
 *
 * Tests the ProductOffer schema structure, backfill repeatability, SKU collision
 * handling, quarantine logic, reservation migration, and reconciliation.
 *
 * Uses jest.unstable_mockModule (ESM pattern) to mock Prisma — no live DB required.
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── Mock Prisma BEFORE importing modules ──────────────────────────────────────
const mockPrisma: any = {
  product: {
    findMany:  jest.fn<(...args: any[]) => any>(),
    update:    jest.fn<(...args: any[]) => any>(),
    count:     jest.fn<(...args: any[]) => any>(),
  },
  productVariant: {
    findMany: jest.fn<(...args: any[]) => any>(),
  },
  productOffer: {
    create:   jest.fn<(...args: any[]) => any>(),
    findMany: jest.fn<(...args: any[]) => any>(),
  },
  productQuarantineLog: {
    create: jest.fn<(...args: any[]) => any>(),
  },
  inventoryReservation: {
    findMany: jest.fn<(...args: any[]) => any>(),
    update:   jest.fn<(...args: any[]) => any>(),
    count:    jest.fn<(...args: any[]) => any>(),
  },
};

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

const { runCatalogueBackfill, reconcileLegacyToOffers } =
  await import('../services/backfill.service.js');

// jest.clearAllMocks() does not purge mockResolvedValueOnce queues.
// Use resetAllMocks() so stale return values from one test can't bleed into the next.
beforeEach(() => { jest.resetAllMocks(); });
afterEach(()  => { jest.clearAllMocks(); });

// ── Shared Fixtures ───────────────────────────────────────────────────────────

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id:               'var-001',
    productId:        'prod-001',
    sku:              'SKU-ABC',
    price:            10000,
    compareAtPrice:   null,
    stock:            50,
    reserved:         5,
    lowStockThreshold: 5,
    active:           true,
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id:           'prod-001',
    slug:         'test-product',
    name:         'Test Product',
    sellerId:     'seller-001',
    status:       'ACTIVE',
    currency:     'UGX',
    condition:    'NEW',
    moq:          1,
    wholesaleTiers: null,
    variants:     [makeVariant()],
    offers:       [],
    ...overrides,
  };
}

// ── Tests — Dry-Run Capability ────────────────────────────────────────────────

describe('runCatalogueBackfill — dry-run mode', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('returns a summary with createdOffers > 0 but makes ZERO database writes', async () => {
    mockPrisma.product.findMany.mockResolvedValueOnce([makeProduct()]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);

    const summary = await runCatalogueBackfill({ dryRun: true });

    expect(summary.dryRun).toBe(true);
    expect(summary.createdOffers).toBe(1);
    expect(summary.scannedProducts).toBe(1);
    expect(summary.scannedVariants).toBe(1);
    expect(summary.quarantinedProducts).toBe(0);

    // No writes must have been made
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
    expect(mockPrisma.productQuarantineLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.inventoryReservation.update).not.toHaveBeenCalled();
  });

  it('reports correct counts for a mix of valid and quarantined products (dry-run)', async () => {
    const products = [
      makeProduct({ id: 'p1', sellerId: 'seller-A', variants: [makeVariant({ id: 'v1', productId: 'p1' })] }),
      makeProduct({ id: 'p2', sellerId: '',          variants: [makeVariant({ id: 'v2', productId: 'p2' })], slug: 'bad-seller' }),
      makeProduct({ id: 'p3', sellerId: 'seller-A', variants: [], slug: 'no-variants' }),
    ];
    mockPrisma.product.findMany.mockResolvedValueOnce(products);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);

    const summary = await runCatalogueBackfill({ dryRun: true });

    expect(summary.scannedProducts).toBe(3);
    expect(summary.quarantinedProducts).toBe(2);  // empty sellerId + zero-variant
    expect(summary.createdOffers).toBe(1);         // only p1 produces an offer
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });
});

// ── Tests — Backfill Repeatability (Idempotency) ──────────────────────────────

describe('runCatalogueBackfill — idempotency', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('skips existing offers on second run (WHERE NOT EXISTS guard via deterministic ID)', async () => {
    const deterministicId = 'off_var-001';
    const existingOffer = { id: deterministicId, variantId: 'var-001' };
    const product = makeProduct({ offers: [existingOffer] });
    mockPrisma.product.findMany.mockResolvedValue([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValue([]);

    // First "run" (simulate already-backfilled state via existing offers)
    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.skippedExistingOffers).toBe(1);
    expect(summary.createdOffers).toBe(0);
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('never overwrites an offer whose deterministic ID already exists', async () => {
    const variant  = makeVariant();
    const offerId  = `off_${variant.id}`;
    const product  = makeProduct({ offers: [{ id: offerId }] });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.createdOffers).toBe(0);
    expect(summary.skippedExistingOffers).toBe(1);
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('creates new offers for variants without existing offers (second-pass new variant)', async () => {
    const existingVariant = makeVariant({ id: 'var-001' });
    const newVariant      = makeVariant({ id: 'var-new', sku: 'SKU-NEW' });
    const product = makeProduct({
      variants: [existingVariant, newVariant],
      offers: [{ id: 'off_var-001' }],  // var-001 already has an offer
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({ id: 'off_var-new' });

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.skippedExistingOffers).toBe(1);
    expect(summary.createdOffers).toBe(1);
    expect(mockPrisma.productOffer.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'off_var-new' }) }),
    );
  });
});

// ── Tests — isBuyBoxWinner never auto-assigned ────────────────────────────────

describe('runCatalogueBackfill — Buy Box safety', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('NEVER sets isBuyBoxWinner=true on any backfilled offer', async () => {
    const products = [
      makeProduct({ id: 'p1', variants: [makeVariant({ id: 'v1', productId: 'p1', stock: 100 })] }),
      makeProduct({ id: 'p2', variants: [makeVariant({ id: 'v2', productId: 'p2', stock: 0  })], slug: 'oos' }),
    ];
    mockPrisma.product.findMany.mockResolvedValueOnce(products);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    for (const call of mockPrisma.productOffer.create.mock.calls as any[]) {
      expect(call[0].data.isBuyBoxWinner).toBe(false);
    }
  });
});

// ── Tests — Offer Status Derivation ──────────────────────────────────────────

describe('runCatalogueBackfill — initial offer status', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('assigns ACTIVE when product is ACTIVE, variant is active, and stock available', async () => {
    const product = makeProduct({
      status: 'ACTIVE',
      variants: [makeVariant({ stock: 10, reserved: 2, active: true })],
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('assigns OUT_OF_STOCK when stock minus reserved is 0', async () => {
    const product = makeProduct({
      status: 'ACTIVE',
      variants: [makeVariant({ stock: 5, reserved: 5, active: true })],
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'OUT_OF_STOCK' }) }),
    );
  });

  it('assigns INACTIVE when product status is PENDING_APPROVAL', async () => {
    const product = makeProduct({
      status: 'PENDING_APPROVAL',
      variants: [makeVariant({ stock: 20, reserved: 0, active: true })],
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INACTIVE' }) }),
    );
  });

  it('assigns INACTIVE when variant.active is false', async () => {
    const product = makeProduct({
      status: 'ACTIVE',
      variants: [makeVariant({ stock: 20, reserved: 0, active: false })],
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'INACTIVE' }) }),
    );
  });
});

// ── Tests — Quarantine Logic ──────────────────────────────────────────────────

describe('runCatalogueBackfill — quarantine', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('quarantines products with empty sellerId and logs QUARANTINE_UNVERIFIED_SELLER', async () => {
    const product = makeProduct({ sellerId: '' });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productQuarantineLog.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.quarantinedProducts).toBe(1);
    expect(summary.quarantinedDetails[0].reason).toBe('QUARANTINE_UNVERIFIED_SELLER');
    expect(mockPrisma.productQuarantineLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reason: 'QUARANTINE_UNVERIFIED_SELLER' }),
      }),
    );
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('quarantines products with null sellerId', async () => {
    const product = makeProduct({ sellerId: null });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productQuarantineLog.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.quarantinedProducts).toBe(1);
    expect(summary.quarantinedDetails[0].sellerId).toBeNull();
  });

  it('quarantines sellers NOT in the trustedSellerIds set', async () => {
    const product = makeProduct({ sellerId: 'untrusted-seller' });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productQuarantineLog.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});

    const summary = await runCatalogueBackfill({
      dryRun: false,
      trustedSellerIds: new Set(['seller-001']),
    });

    expect(summary.quarantinedProducts).toBe(1);
    expect(summary.quarantinedDetails[0].reason).toBe('QUARANTINE_UNVERIFIED_SELLER');
  });

  it('allows sellers in trustedSellerIds set', async () => {
    const product = makeProduct({ sellerId: 'seller-trusted' });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    const summary = await runCatalogueBackfill({
      dryRun: false,
      trustedSellerIds: new Set(['seller-trusted']),
    });

    expect(summary.quarantinedProducts).toBe(0);
    expect(summary.createdOffers).toBe(1);
  });

  it('quarantines zero-variant products with ZERO_VARIANTS and sets status to DRAFT', async () => {
    const product = makeProduct({ variants: [] });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productQuarantineLog.create.mockResolvedValue({});
    mockPrisma.product.update.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.quarantinedProducts).toBe(1);
    expect(summary.quarantinedDetails[0].reason).toBe('ZERO_VARIANTS');
    expect(mockPrisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT' }) }),
    );
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('dry-run does NOT write quarantine log or update product status', async () => {
    const product = makeProduct({ sellerId: '' });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);

    const summary = await runCatalogueBackfill({ dryRun: true });

    expect(summary.quarantinedProducts).toBe(1);
    expect(mockPrisma.productQuarantineLog.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
  });
});

// ── Tests — Seller SKU Collision Disambiguation ───────────────────────────────

describe('runCatalogueBackfill — SKU collision disambiguation', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('disambiguates duplicate SKUs within the same seller by appending variant ID suffix', async () => {
    const v1 = makeVariant({ id: 'var-aaa', sku: 'DUPE-SKU' });
    const v2 = makeVariant({ id: 'var-bbb', sku: 'DUPE-SKU', productId: 'prod-001' });
    const product = makeProduct({ variants: [v1, v2] });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.skuCollisionsDisambiguated).toBe(1);
    expect(summary.createdOffers).toBe(2);

    const calls = mockPrisma.productOffer.create.mock.calls as any[];
    const skus = calls.map((c: any) => c[0].data.sellerSku);
    // First should be original; second should be disambiguated
    expect(skus[0]).toBe('DUPE-SKU');
    expect(skus[1]).toMatch(/DUPE-SKU-/);  // has suffix appended
    // Both SKUs must be distinct
    expect(new Set(skus).size).toBe(2);
  });

  it('two different sellers can have the same sellerSku without collision', async () => {
    const products = [
      makeProduct({ id: 'p1', sellerId: 'seller-A', slug: 'prod-a', variants: [makeVariant({ id: 'v1', productId: 'p1', sku: 'SHARED-SKU' })] }),
      makeProduct({ id: 'p2', sellerId: 'seller-B', slug: 'prod-b', variants: [makeVariant({ id: 'v2', productId: 'p2', sku: 'SHARED-SKU' })] }),
    ];
    mockPrisma.product.findMany.mockResolvedValueOnce(products);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    // No collision since different sellers — SKU tracking is per product (hence per seller)
    expect(summary.skuCollisionsDisambiguated).toBe(0);
    expect(summary.createdOffers).toBe(2);
  });
});

// ── Tests — Deterministic Offer ID ───────────────────────────────────────────

describe('runCatalogueBackfill — deterministic offer ID', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('creates offer with ID = "off_" + variant.id', async () => {
    const variant  = makeVariant({ id: 'my-variant-id' });
    const product  = makeProduct({ variants: [variant] });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ id: 'off_my-variant-id' }) }),
    );
  });
});

// ── Tests — Reservation Migration ────────────────────────────────────────────

describe('runCatalogueBackfill — reservation migration', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('assigns offerId = "off_" + variantId to unmapped reservations', async () => {
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    const unmappedRes = { id: 'res-001', variantId: 'var-001', offerId: null };
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([unmappedRes]);
    mockPrisma.inventoryReservation.update.mockResolvedValue({});

    const summary = await runCatalogueBackfill({ dryRun: false });

    expect(summary.migratedReservations).toBe(1);
    expect(mockPrisma.inventoryReservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'res-001' },
        data:  expect.objectContaining({ offerId: 'off_var-001', status: 'ACTIVE' }),
      }),
    );
  });

  it('dry-run reports reservation count but makes no updates', async () => {
    mockPrisma.product.findMany.mockResolvedValueOnce([]);
    const unmappedRes = { id: 'res-001', variantId: 'var-001', offerId: null };
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([unmappedRes]);

    const summary = await runCatalogueBackfill({ dryRun: true });

    expect(summary.migratedReservations).toBe(1);
    expect(mockPrisma.inventoryReservation.update).not.toHaveBeenCalled();
  });
});

// ── Tests — Reconciliation ────────────────────────────────────────────────────

describe('reconcileLegacyToOffers()', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('confirms parity when every variant has a matching offer with equal price/stock/reserved', async () => {
    const variant = makeVariant({ id: 'v1', price: 10000, stock: 50, reserved: 5 });
    const offer   = { id: 'off_v1', price: 10000, stock: 50, reserved: 5 };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct(),
      offers: [offer],
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(true);
    expect(report.missingOffersCount).toBe(0);
    expect(report.priceMismatchCount).toBe(0);
    expect(report.stockMismatchCount).toBe(0);
    expect(report.reservedMismatchCount).toBe(0);
    expect(report.discrepancies).toHaveLength(0);
  });

  it('reports MISSING_OFFER when a variant has no corresponding offer', async () => {
    const variant = makeVariant({ id: 'v1' });
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct({ status: 'ACTIVE' }),
      offers: [],   // no offer
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.missingOffersCount).toBe(1);
    expect(report.discrepancies[0].issue).toBe('MISSING_OFFER');
  });

  it('reports PRICE_MISMATCH when offer price differs from variant price', async () => {
    const variant = makeVariant({ id: 'v1', price: 10000 });
    const offer   = { id: 'off_v1', price: 9999, stock: 50, reserved: 5 };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct(),
      offers: [offer],
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.priceMismatchCount).toBe(1);
    expect(report.discrepancies.find(d => d.issue === 'PRICE_MISMATCH')).toBeDefined();
  });

  it('reports STOCK_MISMATCH when offer stock differs from variant stock', async () => {
    const variant = makeVariant({ id: 'v1', stock: 50 });
    const offer   = { id: 'off_v1', price: 10000, stock: 40, reserved: 5 };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct(),
      offers: [offer],
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.stockMismatchCount).toBe(1);
  });

  it('reports RESERVED_MISMATCH when offer reserved differs from variant reserved', async () => {
    const variant = makeVariant({ id: 'v1', reserved: 5 });
    const offer   = { id: 'off_v1', price: 10000, stock: 50, reserved: 10 };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct(),
      offers: [offer],
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.reservedMismatchCount).toBe(1);
  });

  it('reports unmapped reservations when offerId is null on any reservation', async () => {
    const variant = makeVariant({ id: 'v1' });
    const offer   = { id: 'off_v1', price: 10000, stock: 50, reserved: 5 };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct(),
      offers: [offer],
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(3);  // 3 unmapped

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.unmappedReservationsCount).toBe(3);
  });

  it('skips quarantined (REJECTED status) variants from parity check', async () => {
    const variant = makeVariant({ id: 'v1' });
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([{
      ...variant,
      product: makeProduct({ status: 'REJECTED' }),
      offers: [],   // no offer — but should be skipped
    }]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    // Rejected products are excluded from parity — still confirmed
    expect(report.isParityConfirmed).toBe(true);
    expect(report.missingOffersCount).toBe(0);
  });

  it('reports multiple discrepancies across multiple variants', async () => {
    const v1 = { ...makeVariant({ id: 'v1', price: 10000, stock: 50, reserved: 5 }), product: makeProduct(), offers: [] };
    const v2 = { ...makeVariant({ id: 'v2', price: 20000, stock: 30, reserved: 0 }), product: makeProduct({ id: 'p2', slug: 'p2' }), offers: [{ id: 'off_v2', price: 20000, stock: 20, reserved: 0 }] };
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([v1, v2]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const report = await reconcileLegacyToOffers(mockPrisma);

    expect(report.isParityConfirmed).toBe(false);
    expect(report.missingOffersCount).toBe(1);
    expect(report.stockMismatchCount).toBe(1);
    expect(report.discrepancies.length).toBeGreaterThanOrEqual(2);
  });
});

// ── Tests — ProductOffer field contract ──────────────────────────────────────

describe('runCatalogueBackfill — offer field contract', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('passes correct productId, variantId, sellerId, price, currency, moq', async () => {
    const variant  = makeVariant({ id: 'var-x', price: 25000, productId: 'prod-x' });
    const product  = makeProduct({
      id: 'prod-x', sellerId: 'sel-99', currency: 'UGX', moq: 3, condition: 'REFURBISHED',
      variants: [variant],
    });
    mockPrisma.product.findMany.mockResolvedValueOnce([product]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    await runCatalogueBackfill({ dryRun: false });

    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productId: 'prod-x',
          variantId: 'var-x',
          sellerId:  'sel-99',
          price:     25000,
          currency:  'UGX',
          moq:       3,
          condition: 'REFURBISHED',
          isBuyBoxWinner: false,
        }),
      }),
    );
  });
});
