/**
 * Stage 2 — Backfill CLI Runner & Safety Guards Unit Test Suite
 *
 * Tests the CLI runner argument parsing, dry-run safety defaults,
 * confirmation guards, rollback safeguards, quarantine enforcement,
 * idempotent reruns, and reconciliation parity checks.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// ── Mock Prisma BEFORE importing modules ──────────────────────────────────────
const mockPrisma: any = {
  product: {
    findMany: jest.fn<(...args: any[]) => any>(),
    update:   jest.fn<(...args: any[]) => any>(),
    count:    jest.fn<(...args: any[]) => any>(),
  },
  productVariant: {
    findMany: jest.fn<(...args: any[]) => any>(),
  },
  productOffer: {
    create:     jest.fn<(...args: any[]) => any>(),
    findMany:   jest.fn<(...args: any[]) => any>(),
    delete:     jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
  },
  productQuarantineLog: {
    create: jest.fn<(...args: any[]) => any>(),
  },
  inventoryReservation: {
    findMany:   jest.fn<(...args: any[]) => any>(),
    update:     jest.fn<(...args: any[]) => any>(),
    updateMany: jest.fn<(...args: any[]) => any>(),
    count:      jest.fn<(...args: any[]) => any>(),
  },
};

jest.unstable_mockModule('../db/prisma.js', () => ({ prisma: mockPrisma }));

const { main } = await import('../scripts/backfill.cli.js');
const { rollbackCatalogueBackfill, runCatalogueBackfill } = await import('../services/backfill.service.js');

beforeEach(() => {
  jest.resetAllMocks();
  process.env.NODE_ENV = 'test';
  delete process.env.MUNZI_ALLOW_PRODUCTION_BACKFILL;
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── Test Fixtures ─────────────────────────────────────────────────────────────

function makeVariant(overrides: Record<string, unknown> = {}) {
  return {
    id:               'var-001',
    productId:        'prod-001',
    sku:              'SKU-ABC',
    price:            15000,
    compareAtPrice:   null,
    stock:            100,
    reserved:         10,
    lowStockThreshold: 5,
    active:           true,
    ...overrides,
  };
}

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id:           'prod-001',
    slug:         'test-item',
    name:         'Test Item',
    sellerId:     'seller-verified',
    status:       'ACTIVE',
    currency:     'UGX',
    condition:    'NEW',
    moq:          1,
    wholesaleTiers: null,
    variants:     [makeVariant()],
    offers:       [] as any[],
    ...overrides,
  };
}

describe('Backfill CLI Runner — Safety Guards & Modes', () => {
  it('defaults to DRY-RUN mode when no flags are supplied and performs ZERO writes', async () => {
    mockPrisma.product.findMany.mockResolvedValueOnce([makeProduct()]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const exitCode = await main(['node', 'backfill.cli.ts', '--json']);

    expect(exitCode).toBe(0);
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
    expect(mockPrisma.product.update).not.toHaveBeenCalled();
    expect(mockPrisma.inventoryReservation.update).not.toHaveBeenCalled();
  });

  it('rejects --execute without --confirm and exits with code 1', async () => {
    const exitCode = await main(['node', 'backfill.cli.ts', '--execute']);

    expect(exitCode).toBe(1);
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('rejects live execution in production environment without override env var', async () => {
    process.env.NODE_ENV = 'production';

    const exitCode = await main(['node', 'backfill.cli.ts', '--execute', '--confirm']);

    expect(exitCode).toBe(1);
    expect(mockPrisma.productOffer.create).not.toHaveBeenCalled();
  });

  it('allows live execution in production environment when MUNZI_ALLOW_PRODUCTION_BACKFILL=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.MUNZI_ALLOW_PRODUCTION_BACKFILL = 'true';

    mockPrisma.product.findMany.mockResolvedValueOnce([makeProduct()]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const exitCode = await main(['node', 'backfill.cli.ts', '--execute', '--confirm', '--json']);

    expect(exitCode).toBe(0);
    expect(mockPrisma.productOffer.create).toHaveBeenCalledTimes(1);
  });

  it('supports --reconcile mode and exits with code 0 on parity', async () => {
    mockPrisma.productVariant.findMany.mockResolvedValueOnce([]);
    mockPrisma.inventoryReservation.count.mockResolvedValueOnce(0);

    const exitCode = await main(['node', 'backfill.cli.ts', '--reconcile', '--json']);

    expect(exitCode).toBe(0);
  });
});

describe('Backfill Rollback Safeguards', () => {
  it('defaults rollback to dry-run mode and performs ZERO deletions', async () => {
    const candidateOffers = [
      { id: 'off_var-001', createdAt: new Date('2026-11-20T00:00:00Z'), updatedAt: new Date('2026-11-20T00:00:00Z'), reservations: [] },
    ];
    mockPrisma.productOffer.findMany.mockResolvedValueOnce(candidateOffers);

    const summary = await rollbackCatalogueBackfill({ dryRun: true, client: mockPrisma });

    expect(summary.dryRun).toBe(true);
    expect(summary.scannedOffers).toBe(1);
    expect(summary.eligibleForRollback).toBe(1);
    expect(summary.rolledBackOffers).toBe(0);
    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('STRICT SAFETY: protects offers with active reservations from deletion during rollback', async () => {
    const candidateOffers = [
      {
        id: 'off_var-001',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        updatedAt: new Date('2026-11-20T00:00:00Z'),
        reservations: [{ id: 'res-1', status: 'ACTIVE' }],
      },
    ];
    mockPrisma.productOffer.findMany.mockResolvedValueOnce(candidateOffers);

    const summary = await rollbackCatalogueBackfill({ dryRun: false, client: mockPrisma });

    expect(summary.scannedOffers).toBe(1);
    expect(summary.protectedOffers).toBe(1);
    expect(summary.eligibleForRollback).toBe(0);
    expect(summary.rolledBackOffers).toBe(0);
    expect(summary.protectedDetails[0].reason).toBe('PROTECTED_HAS_ACTIVE_RESERVATIONS');
    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('STRICT SAFETY: protects subsequently modified offers from deletion during rollback', async () => {
    const candidateOffers = [
      {
        id: 'off_var-001',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        updatedAt: new Date('2026-11-20T02:00:00Z'), // Modified 2 hours later
        isBuyBoxWinner: false,
        reservations: [],
      },
      {
        id: 'off_var-002',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        updatedAt: new Date('2026-11-20T00:00:00Z'),
        isBuyBoxWinner: true, // Promoted to Buy Box winner
        reservations: [],
      },
    ];
    mockPrisma.productOffer.findMany.mockResolvedValueOnce(candidateOffers);

    const summary = await rollbackCatalogueBackfill({ dryRun: false, client: mockPrisma });

    expect(summary.scannedOffers).toBe(2);
    expect(summary.protectedOffers).toBe(2);
    expect(summary.rolledBackOffers).toBe(0);
    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('STRICT SAFETY: protects offers referenced by existing orders from deletion during rollback', async () => {
    const candidateOffers = [
      {
        id: 'off_var-ordered',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        updatedAt: new Date('2026-11-20T00:00:00Z'),
        isBuyBoxWinner: false,
        reservations: [],
      },
    ];
    mockPrisma.productOffer.findMany.mockResolvedValueOnce(candidateOffers);

    // Mock orderChecker confirming offer is referenced in orders
    const mockOrderChecker = jest.fn(async (offerId: string) => offerId === 'off_var-ordered');

    const summary = await rollbackCatalogueBackfill({
      dryRun: false,
      client: mockPrisma,
      orderChecker: mockOrderChecker,
    });

    expect(mockOrderChecker).toHaveBeenCalledWith('off_var-ordered');
    expect(summary.scannedOffers).toBe(1);
    expect(summary.protectedOffers).toBe(1);
    expect(summary.rolledBackOffers).toBe(0);
    expect(summary.protectedDetails[0].reason).toBe('PROTECTED_REFERENCED_BY_ORDERS');
    expect(mockPrisma.productOffer.delete).not.toHaveBeenCalled();
  });

  it('deletes eligible backfilled offers cleanly in live rollback', async () => {
    const candidateOffers = [
      {
        id: 'off_var-clean',
        createdAt: new Date('2026-11-20T00:00:00Z'),
        updatedAt: new Date('2026-11-20T00:00:00Z'),
        isBuyBoxWinner: false,
        reservations: [],
      },
    ];
    mockPrisma.productOffer.findMany.mockResolvedValueOnce(candidateOffers);
    mockPrisma.productOffer.delete.mockResolvedValue({});

    const summary = await rollbackCatalogueBackfill({ dryRun: false, client: mockPrisma });

    expect(summary.scannedOffers).toBe(1);
    expect(summary.eligibleForRollback).toBe(1);
    expect(summary.rolledBackOffers).toBe(1);
    expect(mockPrisma.productOffer.delete).toHaveBeenCalledWith({
      where: { id: 'off_var-clean' },
    });
  });
});

describe('Backfill Scalability & Keyset Pagination', () => {
  it('processes products across multiple batches using cursor-based pagination', async () => {
    const p1 = makeProduct({ id: 'p1', variants: [makeVariant({ id: 'v1', productId: 'p1' })] });
    const p2 = makeProduct({ id: 'p2', variants: [makeVariant({ id: 'v2', productId: 'p2' })] });
    const p3 = makeProduct({ id: 'p3', variants: [makeVariant({ id: 'v3', productId: 'p3' })] });

    // Batch 1: returns p1, p2 (size = 2, so hasMore stays true)
    mockPrisma.product.findMany.mockResolvedValueOnce([p1, p2]);
    // Batch 2: returns p3 (size = 1 < batchSize, hasMore becomes false)
    mockPrisma.product.findMany.mockResolvedValueOnce([p3]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({});

    const progressLog: Array<{ batch: number; count: number }> = [];

    const summary = await runCatalogueBackfill({
      dryRun: false,
      batchSize: 2,
      client: mockPrisma,
      onBatchProgress: (batch, count) => progressLog.push({ batch, count }),
    });

    expect(summary.scannedProducts).toBe(3);
    expect(summary.createdOffers).toBe(3);
    expect(mockPrisma.product.findMany).toHaveBeenCalledTimes(2);

    // Verify first batch call has no cursor
    expect(mockPrisma.product.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        take: 2,
        orderBy: { id: 'asc' },
      }),
    );
    expect(mockPrisma.product.findMany.mock.calls[0][0].cursor).toBeUndefined();

    // Verify second batch call uses cursor of last item from batch 1 (p2)
    expect(mockPrisma.product.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        take: 2,
        skip: 1,
        cursor: { id: 'p2' },
        orderBy: { id: 'asc' },
      }),
    );

    expect(progressLog).toEqual([
      { batch: 1, count: 2 },
      { batch: 2, count: 1 },
    ]);
  });

  it('handles batch boundary failure gracefully and preserves idempotency on rerun', async () => {
    const p1 = makeProduct({ id: 'p1', variants: [makeVariant({ id: 'v1' })] });
    const p2 = makeProduct({ id: 'p2', variants: [makeVariant({ id: 'v2' })] });

    // Simulate batch 1 succeeded previously, so p1 already has an offer:
    p1.offers = [{ id: 'off_v1' }];

    mockPrisma.product.findMany.mockResolvedValueOnce([p1]);
    mockPrisma.product.findMany.mockResolvedValueOnce([p2]);
    mockPrisma.inventoryReservation.findMany.mockResolvedValueOnce([]);
    mockPrisma.productOffer.create.mockResolvedValue({ id: 'off_v2' });

    const summary = await runCatalogueBackfill({
      dryRun: false,
      batchSize: 1,
      client: mockPrisma,
    });

    // p1 was skipped idempotently, p2 was created
    expect(summary.skippedExistingOffers).toBe(1);
    expect(summary.createdOffers).toBe(1);
    expect(mockPrisma.productOffer.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.productOffer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: 'off_v2' }),
      }),
    );
  });
});
