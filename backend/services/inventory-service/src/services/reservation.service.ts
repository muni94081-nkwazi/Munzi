import { addMinutes } from 'date-fns';
import type { PrismaClient } from '../generated/prisma/index.js';
import { bumpEntityVersion } from '../../../../shared/cache/protected-cache.js';
import { logger } from '../utils/logger.js';

// ─── Constants & Codes ─────────────────────────────────────────────────────────

export const SERIALIZATION_FAILURE = '40001';
export const DEADLOCK_DETECTED     = '40P01';

const MAX_RETRIES = 3;

/** Sleep helper — separated so tests can run with simulated timers. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Custom Errors ─────────────────────────────────────────────────────────────

export class VariantNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Variant not found') {
    super(message);
    this.name = 'VariantNotFoundError';
  }
}

export class OfferNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Offer not found') {
    super(message);
    this.name = 'OfferNotFoundError';
  }
}

export class ReservationNotFoundError extends Error {
  readonly status = 404;
  constructor(message = 'Reservation not found') {
    super(message);
    this.name = 'ReservationNotFoundError';
  }
}

export class InsufficientStockError extends Error {
  readonly status = 409;
  constructor(readonly available: number) {
    super(`Insufficient stock: only ${available} unit${available === 1 ? '' : 's'} available`);
    this.name = 'InsufficientStockError';
  }
}

export class ReservationStateConflictError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ReservationStateConflictError';
  }
}

export class ExpiredReservationStockUnavailableError extends Error {
  readonly status = 409;
  readonly code = 'EXPIRED_RESERVATION_STOCK_UNAVAILABLE';
  constructor(message = 'Reservation expired and insufficient available stock remained to fulfill payment recovery') {
    super(message);
    this.name = 'ExpiredReservationStockUnavailableError';
  }
}

export class InventoryInconsistencyError extends Error {
  readonly status = 500;
  constructor(message: string) {
    super(message);
    this.name = 'InventoryInconsistencyError';
  }
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface ReservationResult {
  id:        string;
  expiresAt: Date;
  variantId: string;
  offerId?:  string;
}

export interface ReserveParams {
  variantId:  string;
  quantity:   number;
  sessionId:  string;
  userId?:    string;
  ttlMinutes: number;
}

export interface ReserveOfferParams {
  offerId:    string;
  quantity:   number;
  sessionId:  string;
  userId?:    string;
  ttlMinutes: number;
}

export interface ReleaseParams {
  reservationId?: string;
  variantId?:     string;
  offerId?:       string;
  quantity?:      number;
}

export interface ReleaseResult {
  success:          boolean;
  releasedQuantity: number;
  alreadyReleased?: boolean;
  alreadyExpired?:  boolean;
  offerId?:         string;
  variantId?:       string;
}

export interface DeductParams {
  reservationId?: string;
  variantId?:     string;
  offerId?:       string;
  quantity:       number;
}

export interface DeductResult {
  success:               boolean;
  deductedQuantity:      number;
  alreadyConsumed?:      boolean;
  recoveredFromExpiry?:  boolean;
  offerId?:              string;
  variantId?:            string;
}

export interface RestoreParams {
  variantId?: string;
  offerId?:   string;
  quantity:   number;
  reason?:    string;
}

export interface RestoreResult {
  success:          boolean;
  restoredQuantity: number;
  offerId?:         string;
  variantId?:       string;
}

export interface ReconciliationReport {
  targetId:         string;
  type:             'OFFER' | 'VARIANT';
  stock:            number;
  reserved:         number;
  expectedReserved: number;
  discrepancy:      number;
  isConsistent:     boolean;
  activeHolds:      number;
  corrected?:       boolean;
}

// ─── Helper: Execute with Conflict Retry ──────────────────────────────────────

async function executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (err) {
      if (
        err instanceof VariantNotFoundError ||
        err instanceof OfferNotFoundError ||
        err instanceof ReservationNotFoundError ||
        err instanceof InsufficientStockError ||
        err instanceof ReservationStateConflictError ||
        err instanceof ExpiredReservationStockUnavailableError ||
        err instanceof InventoryInconsistencyError
      ) {
        throw err;
      }

      const code = (err as { code?: string }).code;
      const transient = code === DEADLOCK_DETECTED || code === SERIALIZATION_FAILURE;

      if (!transient || attempt >= MAX_RETRIES) throw err;

      await delay(20 * 2 ** attempt + Math.random() * 20);
      attempt++;
    }
  }
}

// ─── 1. Reserve Offer Inventory ───────────────────────────────────────────────

/**
 * Atomically reserve inventory on a seller-owned ProductOffer.
 *
 * Checks `stock - reserved >= quantity` under the row lock taken by Postgres
 * during the conditional UPDATE. Inserts an InventoryReservation row tagged
 * with both `offerId` and canonical `variantId`.
 */
export async function reserveOfferInventory(
  prisma: PrismaClient,
  params: ReserveOfferParams,
): Promise<ReservationResult> {
  return executeWithRetry(async () => {
    const result = await prisma.$transaction(async (tx) => {
      // Atomic claim on the ProductOffer row
      const claimed = await tx.$queryRaw<Array<{ remaining: number; productId: string; variantId: string }>>`
        UPDATE "ProductOffer"
        SET    reserved = reserved + ${params.quantity}, "updatedAt" = NOW()
        WHERE  id = ${params.offerId}
          AND  status = 'ACTIVE'
          AND  stock - reserved >= ${params.quantity}
        RETURNING stock - reserved AS remaining, "productId", "variantId"
      `;

      if (claimed.length === 0) {
        // Distinguish missing offer from sold out / inactive
        const existing = await tx.$queryRaw<Array<{ available: number; status: string }>>`
          SELECT stock - reserved AS available, status
          FROM   "ProductOffer"
          WHERE  id = ${params.offerId}
        `;

        if (existing.length === 0) throw new OfferNotFoundError();
        if (existing[0].status !== 'ACTIVE') throw new InsufficientStockError(0);
        throw new InsufficientStockError(Number(existing[0].available));
      }

      const reservation = await tx.inventoryReservation.create({
        data: {
          variantId: claimed[0].variantId,
          offerId:   params.offerId,
          userId:    params.userId,
          sessionId: params.sessionId,
          quantity:  params.quantity,
          status:    'ACTIVE',
          expiresAt: addMinutes(new Date(), params.ttlMinutes),
        },
      });

      return {
        id:        reservation.id,
        expiresAt: reservation.expiresAt,
        productId: claimed[0].productId,
        variantId: claimed[0].variantId,
        offerId:   params.offerId,
        remaining: Number(claimed[0].remaining),
      };
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5_000,
    });

    // Derived state outside transaction:
    if (result.remaining === 0) {
      await markOfferOutOfStock(prisma, params.offerId).catch(() => {});
      await markProductOutOfStock(prisma, result.productId).catch(() => {});
    }

    return {
      id:        result.id,
      expiresAt: result.expiresAt,
      variantId: result.variantId,
      offerId:   result.offerId,
    };
  });
}

// ─── 2. Reserve ProductVariant Inventory (Legacy / Canonical) ─────────────────

/**
 * Atomically reserve inventory on a ProductVariant.
 * Preserves existing variant-based behavior for backward compatibility.
 */
export async function reserveVariantInventory(
  prisma: PrismaClient,
  params: ReserveParams,
): Promise<ReservationResult> {
  return executeWithRetry(async () => {
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ remaining: number; productId: string }>>`
        UPDATE "ProductVariant"
        SET    reserved = reserved + ${params.quantity}, "updatedAt" = NOW()
        WHERE  id = ${params.variantId}
          AND  active = true
          AND  stock - reserved >= ${params.quantity}
        RETURNING stock - reserved AS remaining, "productId"
      `;

      if (claimed.length === 0) {
        const existing = await tx.$queryRaw<Array<{ available: number }>>`
          SELECT stock - reserved AS available
          FROM   "ProductVariant"
          WHERE  id = ${params.variantId} AND active = true
        `;

        if (existing.length === 0) throw new VariantNotFoundError();
        throw new InsufficientStockError(Number(existing[0].available));
      }

      const reservation = await tx.inventoryReservation.create({
        data: {
          variantId: params.variantId,
          userId:    params.userId,
          sessionId: params.sessionId,
          quantity:  params.quantity,
          status:    'ACTIVE',
          expiresAt: addMinutes(new Date(), params.ttlMinutes),
        },
      });

      return {
        id:        reservation.id,
        expiresAt: reservation.expiresAt,
        productId: claimed[0].productId,
        variantId: params.variantId,
        remaining: Number(claimed[0].remaining),
      };
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5_000,
    });

    if (result.remaining === 0) {
      await markProductOutOfStock(prisma, result.productId).catch(() => {});
    }

    return {
      id:        result.id,
      expiresAt: result.expiresAt,
      variantId: result.variantId,
    };
  });
}

/** Backward-compatible export */
export const reserveInventory = reserveVariantInventory;

// ─── 3. Atomic Release Operation ──────────────────────────────────────────────

/**
 * Release reserved inventory.
 *
 * Guarantees:
 * - When releasing by `reservationId`, inspects reservation state:
 *   - If already RELEASED: returns idempotent success without double release.
 *   - If already EXPIRED: returns idempotent success without decrementing stock twice.
 *   - If CONSUMED: throws conflict (cannot release a consumed reservation).
 *   - If ACTIVE: transitions status to RELEASED in same transaction as counter decrement.
 * - Counter decrement strictly enforces `WHERE reserved >= quantity`. NEVER uses GREATEST().
 * - If counter decrement affects 0 rows, rolls back transaction and throws InventoryInconsistencyError.
 * - Never deletes InventoryReservation rows; preserves complete audit history.
 */
export async function releaseInventory(
  prisma: PrismaClient,
  params: ReleaseParams,
): Promise<ReleaseResult> {
  return executeWithRetry(async () => {
    const outcome = await prisma.$transaction(async (tx) => {
      if (params.reservationId) {
        // Query reservation with row-level lock
        const resRows = await tx.$queryRaw<Array<{
          id: string;
          variantId: string;
          offerId: string | null;
          quantity: number;
          status: string;
        }>>`
          SELECT id, "variantId", "offerId", quantity, status
          FROM   "InventoryReservation"
          WHERE  id = ${params.reservationId}
          FOR UPDATE
        `;

        if (resRows.length === 0) {
          throw new ReservationNotFoundError();
        }

        const res = resRows[0];

        // Idempotency: Already released
        if (res.status === 'RELEASED') {
          return {
            success:          true,
            releasedQuantity: 0,
            alreadyReleased:  true,
            offerId:          res.offerId ?? undefined,
            variantId:        res.variantId,
          };
        }

        // Idempotency: Already expired (hold was already returned by expiry sweep)
        if (res.status === 'EXPIRED') {
          return {
            success:          true,
            releasedQuantity: 0,
            alreadyExpired:   true,
            offerId:          res.offerId ?? undefined,
            variantId:        res.variantId,
          };
        }

        // Conflict: Cannot release an already consumed reservation
        if (res.status === 'CONSUMED') {
          throw new ReservationStateConflictError('Cannot release a reservation that has already been consumed by an order');
        }

        // Transition status from ACTIVE to RELEASED
        const updatedRes = await tx.$executeRaw`
          UPDATE "InventoryReservation"
          SET    status = 'RELEASED', "updatedAt" = NOW()
          WHERE  id = ${res.id} AND status = 'ACTIVE'
        `;

        if (updatedRes === 0) {
          throw new ReservationStateConflictError('Concurrent reservation state transition detected during release');
        }

        // Strict counter decrement — NEVER use GREATEST()
        if (res.offerId) {
          const updatedOffer = await tx.$executeRaw`
            UPDATE "ProductOffer"
            SET    reserved = reserved - ${res.quantity}, "updatedAt" = NOW()
            WHERE  id = ${res.offerId} AND reserved >= ${res.quantity}
          `;

          if (updatedOffer === 0) {
            throw new InventoryInconsistencyError(
              `Offer inventory counter inconsistency: reserved quantity on offer ${res.offerId} is less than ${res.quantity}`,
            );
          }
        } else {
          const updatedVariant = await tx.$executeRaw`
            UPDATE "ProductVariant"
            SET    reserved = reserved - ${res.quantity}, "updatedAt" = NOW()
            WHERE  id = ${res.variantId} AND reserved >= ${res.quantity}
          `;

          if (updatedVariant === 0) {
            throw new InventoryInconsistencyError(
              `Variant inventory counter inconsistency: reserved quantity on variant ${res.variantId} is less than ${res.quantity}`,
            );
          }
        }

        return {
          success:          true,
          releasedQuantity: res.quantity,
          offerId:          res.offerId ?? undefined,
          variantId:        res.variantId,
        };

      } else if (params.quantity && params.quantity > 0) {
        // Direct quantity release (without specific reservationId)
        if (params.offerId) {
          const updated = await tx.$executeRaw`
            UPDATE "ProductOffer"
            SET    reserved = reserved - ${params.quantity}, "updatedAt" = NOW()
            WHERE  id = ${params.offerId} AND reserved >= ${params.quantity}
          `;

          if (updated === 0) {
            throw new InventoryInconsistencyError(
              `Cannot release ${params.quantity} units: exceeds current reserved count on offer ${params.offerId}`,
            );
          }

          return {
            success:          true,
            releasedQuantity: params.quantity,
            offerId:          params.offerId,
          };
        } else if (params.variantId) {
          const updated = await tx.$executeRaw`
            UPDATE "ProductVariant"
            SET    reserved = reserved - ${params.quantity}, "updatedAt" = NOW()
            WHERE  id = ${params.variantId} AND reserved >= ${params.quantity}
          `;

          if (updated === 0) {
            throw new InventoryInconsistencyError(
              `Cannot release ${params.quantity} units: exceeds current reserved count on variant ${params.variantId}`,
            );
          }

          return {
            success:          true,
            releasedQuantity: params.quantity,
            variantId:        params.variantId,
          };
        } else {
          throw new Error('Must provide reservationId, or offerId/variantId with quantity to release');
        }
      } else {
        throw new Error('Invalid release parameters');
      }
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5_000,
    });

    // Settle derived states outside transaction
    if (outcome.offerId) {
      await settleOfferDerivedState(prisma, outcome.offerId).catch(() => {});
    }
    if (outcome.variantId) {
      await settleVariantDerivedState(prisma, outcome.variantId).catch(() => {});
    }

    return outcome;
  });
}

// ─── 4. Atomic Deduct (Consume) Operation ─────────────────────────────────────

/**
 * Deduct (consume) inventory upon order confirmation.
 *
 * Guarantees:
 * - When deducting with `reservationId`:
 *   - If already CONSUMED: returns idempotent success without double deduction.
 *   - If RELEASED: throws conflict (cannot deduct an already released hold).
 *   - If EXPIRED: Handles the payment-versus-expiry race condition!
 *     Attempts recovery by deducting from unreserved available stock (`stock - reserved >= quantity`).
 *     If unreserved stock is available: transitions reservation to CONSUMED and records recovery.
 *     If unreserved stock is NOT available: rolls back and throws ExpiredReservationStockUnavailableError
 *     (triggering the saga's compensation/refund path rather than overselling or corrupting stock).
 *   - If ACTIVE: transitions status to CONSUMED in same transaction as stock and reserved decrements.
 * - Counter decrement strictly enforces `WHERE stock >= quantity AND reserved >= quantity`. NEVER uses GREATEST().
 * - If counter update affects 0 rows, rolls back transaction and throws InventoryInconsistencyError.
 * - Never deletes InventoryReservation rows; preserves complete audit history.
 */
export async function deductInventory(
  prisma: PrismaClient,
  params: DeductParams,
): Promise<DeductResult> {
  return executeWithRetry(async () => {
    const outcome = await prisma.$transaction(async (tx) => {
      if (params.reservationId) {
        const resRows = await tx.$queryRaw<Array<{
          id: string;
          variantId: string;
          offerId: string | null;
          quantity: number;
          status: string;
        }>>`
          SELECT id, "variantId", "offerId", quantity, status
          FROM   "InventoryReservation"
          WHERE  id = ${params.reservationId}
          FOR UPDATE
        `;

        if (resRows.length === 0) {
          throw new ReservationNotFoundError();
        }

        const res = resRows[0];

        // Idempotency: Already consumed (e.g. duplicated payment webhook or saga retry)
        if (res.status === 'CONSUMED') {
          return {
            success:          true,
            deductedQuantity: 0,
            alreadyConsumed:  true,
            offerId:          res.offerId ?? undefined,
            variantId:        res.variantId,
          };
        }

        // Conflict: Cannot deduct an explicitly released reservation
        if (res.status === 'RELEASED') {
          throw new ReservationStateConflictError('Cannot deduct inventory for an explicitly released reservation');
        }

        // ── Payment-Versus-Expiry Race Handling ──
        if (res.status === 'EXPIRED') {
          // The hold expired while customer payment was in flight.
          // Attempt traceable recovery from unreserved stock.
          if (res.offerId) {
            const recoveryClaim = await tx.$executeRaw`
              UPDATE "ProductOffer"
              SET    stock = stock - ${res.quantity}, "updatedAt" = NOW()
              WHERE  id = ${res.offerId} AND stock - reserved >= ${res.quantity}
            `;

            if (recoveryClaim === 0) {
              throw new ExpiredReservationStockUnavailableError(
                `Payment arrived after reservation ${res.id} expired, and insufficient stock remains on offer ${res.offerId} to fulfill recovery`,
              );
            }
          } else {
            const recoveryClaim = await tx.$executeRaw`
              UPDATE "ProductVariant"
              SET    stock = stock - ${res.quantity}, "updatedAt" = NOW()
              WHERE  id = ${res.variantId} AND stock - reserved >= ${res.quantity}
            `;

            if (recoveryClaim === 0) {
              throw new ExpiredReservationStockUnavailableError(
                `Payment arrived after reservation ${res.id} expired, and insufficient stock remains on variant ${res.variantId} to fulfill recovery`,
              );
            }
          }

          // Recovery claim succeeded: update reservation status to CONSUMED
          await tx.$executeRaw`
            UPDATE "InventoryReservation"
            SET    status = 'CONSUMED', "updatedAt" = NOW()
            WHERE  id = ${res.id}
          `;

          logger.warn('Recovered payment deduction from expired reservation', {
            reservationId: res.id,
            offerId:       res.offerId,
            variantId:     res.variantId,
            quantity:      res.quantity,
          });

          return {
            success:             true,
            deductedQuantity:    res.quantity,
            recoveredFromExpiry: true,
            offerId:             res.offerId ?? undefined,
            variantId:           res.variantId,
          };
        }

        // Normal path: status === 'ACTIVE'
        // Transition status from ACTIVE to CONSUMED
        const updatedRes = await tx.$executeRaw`
          UPDATE "InventoryReservation"
          SET    status = 'CONSUMED', "updatedAt" = NOW()
          WHERE  id = ${res.id} AND status = 'ACTIVE'
        `;

        if (updatedRes === 0) {
          throw new ReservationStateConflictError('Concurrent reservation state transition detected during deduction');
        }

        // Decrement both stock and reserved strictly — NEVER use GREATEST()
        if (res.offerId) {
          const updatedOffer = await tx.$executeRaw`
            UPDATE "ProductOffer"
            SET    stock = stock - ${res.quantity},
                   reserved = reserved - ${res.quantity},
                   "updatedAt" = NOW()
            WHERE  id = ${res.offerId}
              AND  stock >= ${res.quantity}
              AND  reserved >= ${res.quantity}
          `;

          if (updatedOffer === 0) {
            throw new InventoryInconsistencyError(
              `Offer inventory counter inconsistency: insufficient stock or reserved count on offer ${res.offerId} for deducting ${res.quantity}`,
            );
          }
        } else {
          const updatedVariant = await tx.$executeRaw`
            UPDATE "ProductVariant"
            SET    stock = stock - ${res.quantity},
                   reserved = reserved - ${res.quantity},
                   "updatedAt" = NOW()
            WHERE  id = ${res.variantId}
              AND  stock >= ${res.quantity}
              AND  reserved >= ${res.quantity}
          `;

          if (updatedVariant === 0) {
            throw new InventoryInconsistencyError(
              `Variant inventory counter inconsistency: insufficient stock or reserved count on variant ${res.variantId} for deducting ${res.quantity}`,
            );
          }
        }

        return {
          success:          true,
          deductedQuantity: res.quantity,
          offerId:          res.offerId ?? undefined,
          variantId:        res.variantId,
        };

      } else {
        // Direct deduction without reservationId
        if (params.offerId) {
          const updated = await tx.$executeRaw`
            UPDATE "ProductOffer"
            SET    stock = stock - ${params.quantity}, "updatedAt" = NOW()
            WHERE  id = ${params.offerId} AND stock >= ${params.quantity}
          `;

          if (updated === 0) {
            throw new InsufficientStockError(0);
          }

          return {
            success:          true,
            deductedQuantity: params.quantity,
            offerId:          params.offerId,
          };
        } else if (params.variantId) {
          const updated = await tx.$executeRaw`
            UPDATE "ProductVariant"
            SET    stock = stock - ${params.quantity}, "updatedAt" = NOW()
            WHERE  id = ${params.variantId} AND stock >= ${params.quantity}
          `;

          if (updated === 0) {
            throw new InsufficientStockError(0);
          }

          return {
            success:          true,
            deductedQuantity: params.quantity,
            variantId:        params.variantId,
          };
        } else {
          throw new Error('Must provide reservationId, or offerId/variantId with quantity to deduct');
        }
      }
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5_000,
    });

    if (outcome.offerId) {
      await settleOfferDerivedState(prisma, outcome.offerId).catch(() => {});
    }
    if (outcome.variantId) {
      await settleVariantDerivedState(prisma, outcome.variantId).catch(() => {});
    }

    return outcome;
  });
}

// ─── 5. Atomic Restore Operation ──────────────────────────────────────────────

/**
 * Restore goods back to available stock (e.g. order cancelled after deduction).
 */
export async function restoreInventory(
  prisma: PrismaClient,
  params: RestoreParams,
): Promise<RestoreResult> {
  return executeWithRetry(async () => {
    const outcome = await prisma.$transaction(async (tx) => {
      if (params.offerId) {
        const updated = await tx.$executeRaw`
          UPDATE "ProductOffer"
          SET    stock = stock + ${params.quantity}, "updatedAt" = NOW()
          WHERE  id = ${params.offerId}
        `;

        if (updated === 0) throw new OfferNotFoundError();

        return {
          success:          true,
          restoredQuantity: params.quantity,
          offerId:          params.offerId,
        };
      } else if (params.variantId) {
        const updated = await tx.$executeRaw`
          UPDATE "ProductVariant"
          SET    stock = stock + ${params.quantity}, "updatedAt" = NOW()
          WHERE  id = ${params.variantId}
        `;

        if (updated === 0) throw new VariantNotFoundError();

        return {
          success:          true,
          restoredQuantity: params.quantity,
          variantId:        params.variantId,
        };
      } else {
        throw new Error('Must provide offerId or variantId to restore');
      }
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 5_000,
    });

    if (outcome.offerId) {
      await settleOfferDerivedState(prisma, outcome.offerId).catch(() => {});
    }
    if (outcome.variantId) {
      await settleVariantDerivedState(prisma, outcome.variantId).catch(() => {});
    }

    return outcome;
  });
}

// ─── 6. Expiry Sweep Operation ────────────────────────────────────────────────

/**
 * Sweep expired reservations safely without deleting historical records.
 *
 * Atomically transitions status to 'EXPIRED' and decrements the reserved counter
 * on ProductOffer or ProductVariant strictly `WHERE reserved >= quantity`.
 */
export async function sweepExpiredReservations(
  prisma: PrismaClient,
  cutoffDate: Date = new Date(),
  batchSize = 200,
): Promise<{ swept: number; errors: number }> {
  let swept = 0;
  let errors = 0;
  const maxBatches = 10_000;
  let batch = 0;

  while (batch < maxBatches) {
    // Only select reservations that are ACTIVE and have expired
    const expired = await prisma.inventoryReservation.findMany({
      where: {
        expiresAt: { lte: cutoffDate },
        status:    'ACTIVE',
      },
      orderBy: { expiresAt: 'asc' },
      take:    batchSize,
    });

    if (expired.length === 0) break;
    batch++;

    const touchedOffers   = new Set<string>();
    const touchedVariants = new Set<string>();

    for (const res of expired) {
      try {
        await prisma.$transaction(async (tx) => {
          // Transition reservation status atomically
          const updated = await tx.$executeRaw`
            UPDATE "InventoryReservation"
            SET    status = 'EXPIRED', "updatedAt" = NOW()
            WHERE  id = ${res.id} AND status = 'ACTIVE'
          `;

          // If another worker or transaction already transitioned it, skip
          if (updated === 0) return;

          // Decrement counter strictly — NO GREATEST()
          if (res.offerId) {
            const offerUpdate = await tx.$executeRaw`
              UPDATE "ProductOffer"
              SET    reserved = reserved - ${res.quantity}, "updatedAt" = NOW()
              WHERE  id = ${res.offerId} AND reserved >= ${res.quantity}
            `;

            if (offerUpdate === 0) {
              throw new InventoryInconsistencyError(
                `Reserved counter on offer ${res.offerId} is lower than expired reservation quantity ${res.quantity}`,
              );
            }
            touchedOffers.add(res.offerId);
          } else {
            const variantUpdate = await tx.$executeRaw`
              UPDATE "ProductVariant"
              SET    reserved = reserved - ${res.quantity}, "updatedAt" = NOW()
              WHERE  id = ${res.variantId} AND reserved >= ${res.quantity}
            `;

            if (variantUpdate === 0) {
              throw new InventoryInconsistencyError(
                `Reserved counter on variant ${res.variantId} is lower than expired reservation quantity ${res.quantity}`,
              );
            }
            touchedVariants.add(res.variantId);
          }
        });

        swept++;
      } catch (err) {
        errors++;
        logger.error('Failed to expire reservation', {
          reservationId: res.id,
          error:         (err as Error).message,
        });
      }
    }

    // Settle derived states outside transaction
    for (const offerId of touchedOffers) {
      await settleOfferDerivedState(prisma, offerId).catch(() => {});
    }
    for (const variantId of touchedVariants) {
      await settleVariantDerivedState(prisma, variantId).catch(() => {});
    }

    if (expired.length < batchSize) break;
  }

  return { swept, errors };
}

// ─── 7. Inventory Reconciliation ──────────────────────────────────────────────

/**
 * Reconcile inventory counters against active reservations.
 *
 * Checks `actualReserved` against the sum of quantities of all ACTIVE, non-expired reservations.
 * Detects discrepancies without modifying data, or performs an audited correction if requested.
 */
export async function reconcileInventory(
  prisma: PrismaClient,
  target: { offerId?: string; variantId?: string; autoCorrect?: boolean; reason?: string },
): Promise<ReconciliationReport> {
  if (target.offerId) {
    const offer = await prisma.productOffer.findUnique({
      where: { id: target.offerId },
      select: { id: true, stock: true, reserved: true },
    });

    if (!offer) throw new OfferNotFoundError();

    const activeReservations = await prisma.inventoryReservation.aggregate({
      where: {
        offerId:   target.offerId,
        status:    'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      _sum:   { quantity: true },
      _count: { id: true },
    });

    const expectedReserved = activeReservations._sum.quantity ?? 0;
    const discrepancy      = offer.reserved - expectedReserved;
    const isConsistent     = discrepancy === 0;

    let corrected = false;
    if (!isConsistent && target.autoCorrect) {
      await prisma.$executeRaw`
        UPDATE "ProductOffer"
        SET    reserved = ${expectedReserved}, "updatedAt" = NOW()
        WHERE  id = ${target.offerId}
      `;
      logger.warn('Reconciled offer inventory discrepancy', {
        offerId:          target.offerId,
        previousReserved: offer.reserved,
        expectedReserved,
        discrepancy,
        reason:           target.reason ?? 'Automated reconciliation audit',
      });
      corrected = true;
      await settleOfferDerivedState(prisma, target.offerId).catch(() => {});
    }

    return {
      targetId:         target.offerId,
      type:             'OFFER',
      stock:            offer.stock,
      reserved:         corrected ? expectedReserved : offer.reserved,
      expectedReserved,
      discrepancy,
      isConsistent,
      activeHolds:      activeReservations._count.id,
      corrected,
    };

  } else if (target.variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: target.variantId },
      select: { id: true, stock: true, reserved: true },
    });

    if (!variant) throw new VariantNotFoundError();

    // Sum reservations that target this variant AND do not belong to an offer
    const activeReservations = await prisma.inventoryReservation.aggregate({
      where: {
        variantId: target.variantId,
        offerId:   null,
        status:    'ACTIVE',
        expiresAt: { gt: new Date() },
      },
      _sum:   { quantity: true },
      _count: { id: true },
    });

    const expectedReserved = activeReservations._sum.quantity ?? 0;
    const discrepancy      = variant.reserved - expectedReserved;
    const isConsistent     = discrepancy === 0;

    let corrected = false;
    if (!isConsistent && target.autoCorrect) {
      await prisma.$executeRaw`
        UPDATE "ProductVariant"
        SET    reserved = ${expectedReserved}, "updatedAt" = NOW()
        WHERE  id = ${target.variantId}
      `;
      logger.warn('Reconciled variant inventory discrepancy', {
        variantId:        target.variantId,
        previousReserved: variant.reserved,
        expectedReserved,
        discrepancy,
        reason:           target.reason ?? 'Automated reconciliation audit',
      });
      corrected = true;
      await settleVariantDerivedState(prisma, target.variantId).catch(() => {});
    }

    return {
      targetId:         target.variantId,
      type:             'VARIANT',
      stock:            variant.stock,
      reserved:         corrected ? expectedReserved : variant.reserved,
      expectedReserved,
      discrepancy,
      isConsistent,
      activeHolds:      activeReservations._count.id,
      corrected,
    };
  } else {
    throw new Error('Must provide offerId or variantId to reconcile');
  }
}

// ─── 8. Offer & Product Availability Helpers ──────────────────────────────────

/** Flip an offer to OUT_OF_STOCK when available stock reaches zero. */
export async function markOfferOutOfStock(prisma: PrismaClient, offerId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ProductOffer"
    SET    status = 'OUT_OF_STOCK', "updatedAt" = NOW()
    WHERE  id = ${offerId}
      AND  status = 'ACTIVE'
      AND  stock - reserved <= 0
  `;
}

/** Restore an offer to ACTIVE when sellable stock becomes available again. */
export async function restoreOfferAvailability(prisma: PrismaClient, offerId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "ProductOffer"
    SET    status = 'ACTIVE', "updatedAt" = NOW()
    WHERE  id = ${offerId}
      AND  status = 'OUT_OF_STOCK'
      AND  stock - reserved > 0
  `;
}

/**
 * Flip a product back to ACTIVE once some variant or offer has sellable stock again.
 */
export async function restoreProductAvailability(prisma: PrismaClient, productId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Product"
    SET    status = 'ACTIVE'
    WHERE  id = ${productId}
      AND  status = 'OUT_OF_STOCK'
      AND  (
        EXISTS (
          SELECT 1 FROM "ProductVariant"
          WHERE "productId" = ${productId}
            AND active = true
            AND stock - reserved > 0
        )
        OR EXISTS (
          SELECT 1 FROM "ProductOffer"
          WHERE "productId" = ${productId}
            AND status = 'ACTIVE'
            AND stock - reserved > 0
        )
      )
  `;
}

/** Flip a product to OUT_OF_STOCK once no active variant or offer has sellable stock. */
export async function markProductOutOfStock(prisma: PrismaClient, productId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Product"
    SET    status = 'OUT_OF_STOCK'
    WHERE  id = ${productId}
      AND  status = 'ACTIVE'
      AND  NOT EXISTS (
        SELECT 1 FROM "ProductVariant"
        WHERE "productId" = ${productId}
          AND active = true
          AND stock - reserved > 0
      )
      AND  NOT EXISTS (
        SELECT 1 FROM "ProductOffer"
        WHERE "productId" = ${productId}
          AND status = 'ACTIVE'
          AND stock - reserved > 0
      )
  `;
}

/**
 * Settle derived state following an offer stock movement.
 */
export async function settleOfferDerivedState(prisma: PrismaClient, offerId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    productId: string;
    slug: string | null;
    stock: number;
    reserved: number;
    status: string;
  }>>`
    SELECT o."productId" AS "productId", p.slug AS slug, o.stock, o.reserved, o.status
    FROM "ProductOffer" o
    JOIN "Product" p ON p.id = o."productId"
    WHERE o.id = ${offerId}
    LIMIT 1
  `.catch(() => [] as Array<{ productId: string; slug: string | null; stock: number; reserved: number; status: string }>);

  const offer = rows[0];
  if (!offer) return;

  if (offer.stock - offer.reserved > 0 && offer.status === 'OUT_OF_STOCK') {
    await restoreOfferAvailability(prisma, offerId).catch(() => {});
  } else if (offer.stock - offer.reserved <= 0 && offer.status === 'ACTIVE') {
    await markOfferOutOfStock(prisma, offerId).catch(() => {});
  }

  await restoreProductAvailability(prisma, offer.productId).catch(() => {});

  await bumpEntityVersion('product', offer.productId).catch(() => {});
  if (offer.slug) {
    await bumpEntityVersion('product-slug', offer.slug).catch(() => {});
  }
}

/**
 * Settle derived state following a variant stock movement.
 */
export async function settleVariantDerivedState(prisma: PrismaClient, variantId: string): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ productId: string; slug: string | null }>>`
    SELECT v."productId" AS "productId", p.slug AS slug
    FROM "ProductVariant" v
    JOIN "Product" p ON p.id = v."productId"
    WHERE v.id = ${variantId}
    LIMIT 1
  `.catch(() => [] as Array<{ productId: string; slug: string | null }>);

  const variant = rows[0];
  if (!variant) return;

  await restoreProductAvailability(prisma, variant.productId).catch(() => {});

  await bumpEntityVersion('product', variant.productId).catch(() => {});
  if (variant.slug) {
    await bumpEntityVersion('product-slug', variant.slug).catch(() => {});
  }
}
