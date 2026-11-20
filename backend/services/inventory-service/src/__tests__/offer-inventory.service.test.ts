import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  reserveOfferInventory,
  reserveVariantInventory,
  releaseInventory,
  deductInventory,
  restoreInventory,
  sweepExpiredReservations,
  reconcileInventory,
  InsufficientStockError,
  OfferNotFoundError,
  VariantNotFoundError,
  ReservationNotFoundError,
  ReservationStateConflictError,
  ExpiredReservationStockUnavailableError,
  InventoryInconsistencyError,
} from '../services/reservation.service.js';

// ─── In-Memory Database Double ────────────────────────────────────────────────

interface OfferRow {
  id:        string;
  productId: string;
  variantId: string;
  sellerId:  string;
  stock:     number;
  reserved:  number;
  status:    string;
}

interface VariantRow {
  id:        string;
  productId: string;
  stock:     number;
  reserved:  number;
  active:    boolean;
}

interface ReservationRow {
  id:        string;
  variantId: string;
  offerId:   string | null;
  userId?:   string;
  sessionId: string;
  quantity:  number;
  status:    string;
  expiresAt: Date;
}

function createTestHarness(initialData: {
  offers?:       OfferRow[];
  variants?:     VariantRow[];
  reservations?: ReservationRow[];
}) {
  const offers       = new Map<string, OfferRow>((initialData.offers ?? []).map((o) => [o.id, { ...o }]));
  const variants     = new Map<string, VariantRow>((initialData.variants ?? []).map((v) => [v.id, { ...v }]));
  const reservations = new Map<string, ReservationRow>((initialData.reservations ?? []).map((r) => [r.id, { ...r }]));

  let resSequence = 100;

  // Transaction handle with rollback support
  const createTx = () => {
    // Snapshot state for atomic rollback
    const offerSnapshot       = new Map(Array.from(offers.entries()).map(([k, v]) => [k, { ...v }]));
    const variantSnapshot     = new Map(Array.from(variants.entries()).map(([k, v]) => [k, { ...v }]));
    const reservationSnapshot = new Map(Array.from(reservations.entries()).map(([k, v]) => [k, { ...v }]));

    const rollback = () => {
      offers.clear();
      offerSnapshot.forEach((v, k) => offers.set(k, { ...v }));
      variants.clear();
      variantSnapshot.forEach((v, k) => variants.set(k, { ...v }));
      reservations.clear();
      reservationSnapshot.forEach((v, k) => reservations.set(k, { ...v }));
    };

    const tx = {
      $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');

        // Reserve Offer
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    reserved = reserved +')) {
          const quantity = Number(values[0]);
          const offerId  = String(values[1]);
          const offer    = offers.get(offerId);

          if (!offer || offer.status !== 'ACTIVE' || offer.stock - offer.reserved < quantity) {
            return [];
          }
          offer.reserved += quantity;
          return [{ remaining: offer.stock - offer.reserved, productId: offer.productId, variantId: offer.variantId }];
        }

        // Probe Offer
        if (sql.includes('SELECT stock - reserved AS available, status') && sql.includes('FROM   "ProductOffer"')) {
          const offerId = String(values[0]);
          const offer   = offers.get(offerId);
          if (!offer) return [];
          return [{ available: offer.stock - offer.reserved, status: offer.status }];
        }

        // Reserve Variant
        if (sql.includes('UPDATE "ProductVariant"') && sql.includes('SET    reserved = reserved +')) {
          const quantity  = Number(values[0]);
          const variantId = String(values[1]);
          const variant   = variants.get(variantId);

          if (!variant || !variant.active || variant.stock - variant.reserved < quantity) {
            return [];
          }
          variant.reserved += quantity;
          return [{ remaining: variant.stock - variant.reserved, productId: variant.productId }];
        }

        // Probe Variant
        if (sql.includes('SELECT stock - reserved AS available') && sql.includes('FROM   "ProductVariant"')) {
          const variantId = String(values[0]);
          const variant   = variants.get(variantId);
          if (!variant || !variant.active) return [];
          return [{ available: variant.stock - variant.reserved }];
        }

        // Query Reservation FOR UPDATE
        if (sql.includes('SELECT id, "variantId", "offerId", quantity, status') && sql.includes('FROM   "InventoryReservation"')) {
          const resId = String(values[0]);
          const res   = reservations.get(resId);
          if (!res) return [];
          return [{ id: res.id, variantId: res.variantId, offerId: res.offerId, quantity: res.quantity, status: res.status }];
        }

        // Settle Offer / Variant queries
        if (sql.includes('FROM "ProductOffer" o')) {
          const offerId = String(values[0]);
          const offer   = offers.get(offerId);
          if (!offer) return [];
          return [{ productId: offer.productId, slug: 'test-product', stock: offer.stock, reserved: offer.reserved, status: offer.status }];
        }

        if (sql.includes('FROM "ProductVariant" v')) {
          const variantId = String(values[0]);
          const variant   = variants.get(variantId);
          if (!variant) return [];
          return [{ productId: variant.productId, slug: 'test-product' }];
        }

        return [];
      }),

      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');

        // Transition Reservation Status
        if (sql.includes('UPDATE "InventoryReservation"') && sql.includes("SET    status = 'RELEASED'")) {
          const resId = String(values[0]);
          const res   = reservations.get(resId);
          if (!res || res.status !== 'ACTIVE') return 0;
          res.status = 'RELEASED';
          return 1;
        }

        if (sql.includes('UPDATE "InventoryReservation"') && sql.includes("SET    status = 'CONSUMED'")) {
          const resId = String(values[0]);
          const res   = reservations.get(resId);
          if (!res) return 0;
          if (sql.includes("AND status = 'ACTIVE'") && res.status !== 'ACTIVE') return 0;
          res.status = 'CONSUMED';
          return 1;
        }

        if (sql.includes('UPDATE "InventoryReservation"') && sql.includes("SET    status = 'EXPIRED'")) {
          const resId = String(values[0]);
          const res   = reservations.get(resId);
          if (!res || res.status !== 'ACTIVE') return 0;
          res.status = 'EXPIRED';
          return 1;
        }

        // Offer Decrement Reserved (Release)
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    reserved = reserved -')) {
          const qty     = Number(values[0]);
          const offerId = String(values[1]);
          const offer   = offers.get(offerId);
          if (!offer || offer.reserved < qty) return 0;
          offer.reserved -= qty;
          return 1;
        }

        // Offer Decrement Stock & Reserved (Deduct / Consume)
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    stock = stock -') && sql.includes('reserved = reserved -')) {
          const qtyStock = Number(values[0]);
          const qtyRes   = Number(values[1]);
          const offerId  = String(values[2]);
          const offer    = offers.get(offerId);
          if (!offer || offer.stock < qtyStock || offer.reserved < qtyRes) return 0;
          offer.stock    -= qtyStock;
          offer.reserved -= qtyRes;
          return 1;
        }

        // Offer Payment Recovery (Deduct stock directly when unreserved stock >= qty)
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    stock = stock -') && sql.includes('stock - reserved >=')) {
          const qty     = Number(values[0]);
          const offerId = String(values[1]);
          const offer   = offers.get(offerId);
          if (!offer || (offer.stock - offer.reserved) < qty) return 0;
          offer.stock -= qty;
          return 1;
        }

        // Variant Decrement Reserved (Release)
        if (sql.includes('UPDATE "ProductVariant"') && sql.includes('SET    reserved = reserved -')) {
          const qty       = Number(values[0]);
          const variantId = String(values[1]);
          const variant   = variants.get(variantId);
          if (!variant || variant.reserved < qty) return 0;
          variant.reserved -= qty;
          return 1;
        }

        // Variant Decrement Stock & Reserved (Deduct / Consume)
        if (sql.includes('UPDATE "ProductVariant"') && sql.includes('SET    stock = stock -') && sql.includes('reserved = reserved -')) {
          const qtyStock  = Number(values[0]);
          const qtyRes    = Number(values[1]);
          const variantId = String(values[2]);
          const variant   = variants.get(variantId);
          if (!variant || variant.stock < qtyStock || variant.reserved < qtyRes) return 0;
          variant.stock    -= qtyStock;
          variant.reserved -= qtyRes;
          return 1;
        }

        // Variant Recovery
        if (sql.includes('UPDATE "ProductVariant"') && sql.includes('SET    stock = stock -') && sql.includes('stock - reserved >=')) {
          const qty       = Number(values[0]);
          const variantId = String(values[1]);
          const variant   = variants.get(variantId);
          if (!variant || (variant.stock - variant.reserved) < qty) return 0;
          variant.stock -= qty;
          return 1;
        }

        // Restore Stock
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    stock = stock +')) {
          const qty     = Number(values[0]);
          const offerId = String(values[1]);
          const offer   = offers.get(offerId);
          if (!offer) return 0;
          offer.stock += qty;
          return 1;
        }

        if (sql.includes('UPDATE "ProductVariant"') && sql.includes('SET    stock = stock +')) {
          const qty       = Number(values[0]);
          const variantId = String(values[1]);
          const variant   = variants.get(variantId);
          if (!variant) return 0;
          variant.stock += qty;
          return 1;
        }

        // Reconciliation Correction
        if (sql.includes('UPDATE "ProductOffer"') && sql.includes('SET    reserved =')) {
          const newRes  = Number(values[0]);
          const offerId = String(values[1]);
          const offer   = offers.get(offerId);
          if (!offer) return 0;
          offer.reserved = newRes;
          return 1;
        }

        return 1;
      }),

      inventoryReservation: {
        create: jest.fn(async ({ data }: { data: ReservationRow }) => {
          const id = `res-${++resSequence}`;
          const row: ReservationRow = { ...data, id };
          reservations.set(id, row);
          return row;
        }),
      },
    };

    return { tx, rollback };
  };

  const prisma = {
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const { tx, rollback } = createTx();
      try {
        return await fn(tx);
      } catch (err) {
        rollback();
        throw err;
      }
    }),

    $queryRaw:   jest.fn(async (...args: any[]) => { const { tx } = createTx(); return tx.$queryRaw(...args); }),
    $executeRaw: jest.fn(async (...args: any[]) => { const { tx } = createTx(); return tx.$executeRaw(...args); }),

    inventoryReservation: {
      findMany: jest.fn(async ({ where }: { where: any }) => {
        return Array.from(reservations.values()).filter((r) => {
          if (where.status && r.status !== where.status) return false;
          if (where.offerId && r.offerId !== where.offerId) return false;
          if (where.variantId && r.variantId !== where.variantId) return false;
          if (where.expiresAt?.lte && r.expiresAt > where.expiresAt.lte) return false;
          return true;
        });
      }),
      aggregate: jest.fn(async ({ where }: { where: any }) => {
        const matches = Array.from(reservations.values()).filter((r) => {
          if (where.status && r.status !== where.status) return false;
          if (where.offerId !== undefined && r.offerId !== where.offerId) return false;
          if (where.variantId && r.variantId !== where.variantId) return false;
          if (where.expiresAt?.gt && r.expiresAt <= where.expiresAt.gt) return false;
          return true;
        });
        const total = matches.reduce((acc, r) => acc + r.quantity, 0);
        return {
          _sum:   { quantity: total },
          _count: { id: matches.length },
        };
      }),
    },

    productOffer: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return offers.get(where.id) ?? null;
      }),
    },

    productVariant: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        return variants.get(where.id) ?? null;
      }),
    },
  };

  return { prisma, offers, variants, reservations };
}

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('Gate 2C.3: Offer-Based Inventory Integration', () => {

  // 1. Offer Inventory Reservation
  describe('reserveOfferInventory', () => {
    it('successfully reserves available offer stock and increments reserved counter', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 2, status: 'ACTIVE' }],
      });

      const result = await reserveOfferInventory(prisma as any, {
        offerId:    'off-1',
        quantity:   3,
        sessionId:  'sess-abc',
        userId:     'user-1',
        ttlMinutes: 15,
      });

      expect(result.id).toMatch(/^res-/);
      expect(result.offerId).toBe('off-1');
      expect(result.variantId).toBe('v1');
      expect(offers.get('off-1')!.reserved).toBe(5);
      expect(reservations.get(result.id)!.status).toBe('ACTIVE');
      expect(reservations.get(result.id)!.quantity).toBe(3);
    });

    it('rejects with InsufficientStockError when requested quantity exceeds available stock', async () => {
      const { prisma, offers } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 8, status: 'ACTIVE' }],
      });

      await expect(
        reserveOfferInventory(prisma as any, {
          offerId:    'off-1',
          quantity:   3,
          sessionId:  'sess-abc',
          ttlMinutes: 15,
        }),
      ).rejects.toBeInstanceOf(InsufficientStockError);

      expect(offers.get('off-1')!.reserved).toBe(8); // Unchanged
    });

    it('throws OfferNotFoundError when offer does not exist', async () => {
      const { prisma } = createTestHarness({});

      await expect(
        reserveOfferInventory(prisma as any, {
          offerId:    'non-existent',
          quantity:   1,
          sessionId:  'sess-abc',
          ttlMinutes: 15,
        }),
      ).rejects.toBeInstanceOf(OfferNotFoundError);
    });
  });

  // 2. Concurrency & Contention on Last Unit
  describe('concurrent last-unit reservation contention', () => {
    it('admits exactly one buyer when multiple concurrent requests compete for the last unit', async () => {
      const { prisma, offers } = createTestHarness({
        offers: [{ id: 'off-flash', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 1, reserved: 0, status: 'ACTIVE' }],
      });

      const attempts = await Promise.allSettled(
        Array.from({ length: 50 }, (_, i) =>
          reserveOfferInventory(prisma as any, {
            offerId:    'off-flash',
            quantity:   1,
            sessionId:  `sess-${i}`,
            ttlMinutes: 15,
          }),
        ),
      );

      const won  = attempts.filter((a) => a.status === 'fulfilled');
      const lost = attempts.filter((a) => a.status === 'rejected');

      expect(won).toHaveLength(1);
      expect(lost).toHaveLength(49);
      expect(offers.get('off-flash')!.reserved).toBe(1);
    });
  });

  // 3. Atomic Rollback on Counter Inconsistency
  describe('atomic rollback', () => {
    it('rolls back reservation state transition if counter update fails', async () => {
      // Simulates inconsistent state where reservation says quantity=5 but reserved counter was somehow corrupted to 2
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 2, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-corrupt',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  5, // Quantity 5 > reserved 2
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      await expect(
        releaseInventory(prisma as any, { reservationId: 'res-corrupt' }),
      ).rejects.toBeInstanceOf(InventoryInconsistencyError);

      // Verify atomic rollback: reservation must remain ACTIVE (not RELEASED) and reserved count untouched
      expect(reservations.get('res-corrupt')!.status).toBe('ACTIVE');
      expect(offers.get('off-1')!.reserved).toBe(2);
    });
  });

  // 4. Reservation Release & Idempotency
  describe('releaseInventory', () => {
    it('transitions reservation from ACTIVE to RELEASED and decrements reserved counter', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 4, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-rel-1',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  3,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      const res = await releaseInventory(prisma as any, { reservationId: 'res-rel-1' });

      expect(res.success).toBe(true);
      expect(res.releasedQuantity).toBe(3);
      expect(offers.get('off-1')!.reserved).toBe(1);
      expect(reservations.get('res-rel-1')!.status).toBe('RELEASED');
    });

    it('returns idempotent success without double decrement when called twice on the same reservation', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 3, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-rel-2',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  3,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      // First call
      const first = await releaseInventory(prisma as any, { reservationId: 'res-rel-2' });
      expect(first.releasedQuantity).toBe(3);
      expect(offers.get('off-1')!.reserved).toBe(0);

      // Duplicate call
      const second = await releaseInventory(prisma as any, { reservationId: 'res-rel-2' });
      expect(second.success).toBe(true);
      expect(second.alreadyReleased).toBe(true);
      expect(second.releasedQuantity).toBe(0);
      expect(offers.get('off-1')!.reserved).toBe(0); // NOT negative
    });

    it('refuses to release an already consumed reservation', async () => {
      const { prisma } = createTestHarness({
        reservations: [{
          id:        'res-consumed',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  2,
          status:    'CONSUMED',
          expiresAt: new Date(),
        }],
      });

      await expect(
        releaseInventory(prisma as any, { reservationId: 'res-consumed' }),
      ).rejects.toBeInstanceOf(ReservationStateConflictError);
    });
  });

  // 5. Reservation Consumption & Idempotency
  describe('deductInventory', () => {
    it('transitions reservation from ACTIVE to CONSUMED and decrements both stock and reserved', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 3, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-ded-1',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  3,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      const result = await deductInventory(prisma as any, {
        reservationId: 'res-ded-1',
        quantity:      3,
      });

      expect(result.success).toBe(true);
      expect(result.deductedQuantity).toBe(3);
      expect(offers.get('off-1')!.stock).toBe(7);
      expect(offers.get('off-1')!.reserved).toBe(0);
      expect(reservations.get('res-ded-1')!.status).toBe('CONSUMED');
    });

    it('handles duplicate deduct calls idempotently without double deduction', async () => {
      const { prisma, offers } = createTestHarness({
        offers: [{ id: 'off-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 2, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-ded-2',
          variantId: 'v1',
          offerId:   'off-1',
          sessionId: 'sess-1',
          quantity:  2,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      const first = await deductInventory(prisma as any, { reservationId: 'res-ded-2', quantity: 2 });
      expect(first.deductedQuantity).toBe(2);
      expect(offers.get('off-1')!.stock).toBe(8);
      expect(offers.get('off-1')!.reserved).toBe(0);

      // Duplicate payment callback / deduct retry
      const second = await deductInventory(prisma as any, { reservationId: 'res-ded-2', quantity: 2 });
      expect(second.success).toBe(true);
      expect(second.alreadyConsumed).toBe(true);
      expect(second.deductedQuantity).toBe(0);
      expect(offers.get('off-1')!.stock).toBe(8); // Did not double deduct!
    });
  });

  // 6. Payment-Expiry Race Handling
  describe('payment-versus-expiry race condition', () => {
    it('recovers from expired reservation by claiming unreserved stock when stock remains available', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        // Stock 5, reserved 0 (hold was expired), unreserved stock is 5
        offers: [{ id: 'off-race', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 5, reserved: 0, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-expired-race',
          variantId: 'v1',
          offerId:   'off-race',
          sessionId: 'sess-late-buyer',
          quantity:  2,
          status:    'EXPIRED', // Swept prior to payment arrival
          expiresAt: new Date(Date.now() - 10_000),
        }],
      });

      const res = await deductInventory(prisma as any, {
        reservationId: 'res-expired-race',
        quantity:      2,
      });

      expect(res.success).toBe(true);
      expect(res.recoveredFromExpiry).toBe(true);
      expect(res.deductedQuantity).toBe(2);
      expect(offers.get('off-race')!.stock).toBe(3); // Decremented from available stock
      expect(offers.get('off-race')!.reserved).toBe(0);
      expect(reservations.get('res-expired-race')!.status).toBe('CONSUMED');
    });

    it('rejects with ExpiredReservationStockUnavailableError when reservation expired and stock was taken by another buyer', async () => {
      const { prisma, offers, reservations } = createTestHarness({
        // Stock 1, but already reserved 1 by another customer (0 unreserved available)
        offers: [{ id: 'off-sold-out', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 1, reserved: 1, status: 'ACTIVE' }],
        reservations: [{
          id:        'res-lost-hold',
          variantId: 'v1',
          offerId:   'off-sold-out',
          sessionId: 'sess-buyer-slow',
          quantity:  1,
          status:    'EXPIRED',
          expiresAt: new Date(Date.now() - 60_000),
        }],
      });

      await expect(
        deductInventory(prisma as any, {
          reservationId: 'res-lost-hold',
          quantity:      1,
        }),
      ).rejects.toBeInstanceOf(ExpiredReservationStockUnavailableError);

      // Zero overselling: stock remains 1, reserved remains 1
      expect(offers.get('off-sold-out')!.stock).toBe(1);
      expect(offers.get('off-sold-out')!.reserved).toBe(1);
      expect(reservations.get('res-lost-hold')!.status).toBe('EXPIRED');
    });
  });

  // 7. Reservation Expiry Sweep (Audit Trail Preserved)
  describe('sweepExpiredReservations', () => {
    it('sweeps expired reservations to EXPIRED status, decrements reserved counter, and preserves audit rows without deleting', async () => {
      const now = new Date();
      const { prisma, offers, reservations } = createTestHarness({
        offers: [{ id: 'off-exp', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 4, status: 'ACTIVE' }],
        reservations: [
          {
            id:        'res-past',
            variantId: 'v1',
            offerId:   'off-exp',
            sessionId: 'sess-old',
            quantity:  4,
            status:    'ACTIVE',
            expiresAt: new Date(now.getTime() - 5_000), // In the past
          },
          {
            id:        'res-future',
            variantId: 'v1',
            offerId:   'off-exp',
            sessionId: 'sess-new',
            quantity:  2,
            status:    'ACTIVE',
            expiresAt: new Date(now.getTime() + 600_000), // In future
          },
        ],
      });

      const { swept, errors } = await sweepExpiredReservations(prisma as any, now, 100);

      expect(swept).toBe(1);
      expect(errors).toBe(0);
      expect(offers.get('off-exp')!.reserved).toBe(0); // 4 - 4
      expect(reservations.get('res-past')!.status).toBe('EXPIRED');
      expect(reservations.get('res-future')!.status).toBe('ACTIVE');
      // Audit preservation: reservation was NOT deleted
      expect(reservations.has('res-past')).toBe(true);
    });
  });

  // 8. Restore Inventory (Goods Returned / Order Cancelled)
  describe('restoreInventory', () => {
    it('restores stock onto the offer and triggers availability settlement', async () => {
      const { prisma, offers } = createTestHarness({
        offers: [{ id: 'off-rest', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 0, reserved: 0, status: 'OUT_OF_STOCK' }],
      });

      const res = await restoreInventory(prisma as any, {
        offerId:  'off-rest',
        quantity: 5,
        reason:   'Customer return / cancellation',
      });

      expect(res.success).toBe(true);
      expect(res.restoredQuantity).toBe(5);
      expect(offers.get('off-rest')!.stock).toBe(5);
    });
  });

  // 9. Reconciliation of Offer Inventory Against Reservations
  describe('reconcileInventory', () => {
    it('reports consistent state when reserved counter matches sum of active holds', async () => {
      const now = new Date();
      const { prisma } = createTestHarness({
        offers: [{ id: 'off-rec-1', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 5, status: 'ACTIVE' }],
        reservations: [
          { id: 'r1', variantId: 'v1', offerId: 'off-rec-1', sessionId: 's1', quantity: 3, status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000) },
          { id: 'r2', variantId: 'v1', offerId: 'off-rec-1', sessionId: 's2', quantity: 2, status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000) },
          { id: 'r3', variantId: 'v1', offerId: 'off-rec-1', sessionId: 's3', quantity: 1, status: 'EXPIRED', expiresAt: new Date(now.getTime() - 60_000) },
        ],
      });

      const report = await reconcileInventory(prisma as any, { offerId: 'off-rec-1' });

      expect(report.isConsistent).toBe(true);
      expect(report.reserved).toBe(5);
      expect(report.expectedReserved).toBe(5);
      expect(report.discrepancy).toBe(0);
      expect(report.activeHolds).toBe(2);
    });

    it('detects and can auto-correct inventory discrepancies with audit log', async () => {
      const now = new Date();
      const { prisma, offers } = createTestHarness({
        // Inconsistent: offer says reserved=8, but only holds for 3 exist
        offers: [{ id: 'off-drift', productId: 'p1', variantId: 'v1', sellerId: 's1', stock: 10, reserved: 8, status: 'ACTIVE' }],
        reservations: [
          { id: 'r1', variantId: 'v1', offerId: 'off-drift', sessionId: 's1', quantity: 3, status: 'ACTIVE', expiresAt: new Date(now.getTime() + 60_000) },
        ],
      });

      // Audit check without correction
      const report = await reconcileInventory(prisma as any, { offerId: 'off-drift', autoCorrect: false });
      expect(report.isConsistent).toBe(false);
      expect(report.discrepancy).toBe(5); // 8 - 3
      expect(report.corrected).toBe(false);
      expect(offers.get('off-drift')!.reserved).toBe(8);

      // With autoCorrect
      const fixedReport = await reconcileInventory(prisma as any, { offerId: 'off-drift', autoCorrect: true, reason: 'Drift repair' });
      expect(fixedReport.isConsistent).toBe(false);
      expect(fixedReport.corrected).toBe(true);
      expect(fixedReport.reserved).toBe(3);
      expect(offers.get('off-drift')!.reserved).toBe(3); // Corrected to match active holds!
    });
  });

  // 10. Legacy ProductVariant Inventory Regression Protection
  describe('legacy variant inventory compatibility', () => {
    it('reserves variant inventory without offerId unchanged', async () => {
      const { prisma, variants, reservations } = createTestHarness({
        variants: [{ id: 'v-legacy', productId: 'p1', stock: 20, reserved: 5, active: true }],
      });

      const res = await reserveVariantInventory(prisma as any, {
        variantId:  'v-legacy',
        quantity:   4,
        sessionId:  'sess-leg',
        ttlMinutes: 15,
      });

      expect(res.id).toMatch(/^res-/);
      expect(res.variantId).toBe('v-legacy');
      expect(variants.get('v-legacy')!.reserved).toBe(9);
      expect(reservations.get(res.id)!.offerId).toBeFalsy();
    });

    it('releases variant inventory without offerId', async () => {
      const { prisma, variants } = createTestHarness({
        variants: [{ id: 'v-legacy', productId: 'p1', stock: 20, reserved: 8, active: true }],
        reservations: [{
          id:        'res-leg-rel',
          variantId: 'v-legacy',
          offerId:   null,
          sessionId: 'sess-leg',
          quantity:  3,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      const res = await releaseInventory(prisma as any, { reservationId: 'res-leg-rel' });
      expect(res.success).toBe(true);
      expect(res.releasedQuantity).toBe(3);
      expect(variants.get('v-legacy')!.reserved).toBe(5);
    });

    it('deducts variant inventory without offerId', async () => {
      const { prisma, variants } = createTestHarness({
        variants: [{ id: 'v-legacy', productId: 'p1', stock: 20, reserved: 5, active: true }],
        reservations: [{
          id:        'res-leg-ded',
          variantId: 'v-legacy',
          offerId:   null,
          sessionId: 'sess-leg',
          quantity:  5,
          status:    'ACTIVE',
          expiresAt: new Date(Date.now() + 60_000),
        }],
      });

      const res = await deductInventory(prisma as any, { reservationId: 'res-leg-ded', quantity: 5 });
      expect(res.success).toBe(true);
      expect(res.deductedQuantity).toBe(5);
      expect(variants.get('v-legacy')!.stock).toBe(15);
      expect(variants.get('v-legacy')!.reserved).toBe(0);
    });
  });
});
