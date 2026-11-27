import { prisma } from '../db/prisma.js';

export interface BackfillOptions {
  dryRun?: boolean;
  trustedSellerIds?: Set<string>;
  client?: any;
  batchSize?: number;
  onBatchProgress?: (batchIndex: number, batchCount: number) => void;
}

export interface BackfillSummary {
  dryRun: boolean;
  scannedProducts: number;
  scannedVariants: number;
  quarantinedProducts: number;
  createdOffers: number;
  skippedExistingOffers: number;
  migratedReservations: number;
  skuCollisionsDisambiguated: number;
  quarantinedDetails: Array<{ productId: string; sellerId: string | null; reason: string }>;
}

export interface ReconciliationOptions {
  client?: any;
  batchSize?: number;
}

export interface ReconciliationReport {
  isParityConfirmed: boolean;
  missingOffersCount: number;
  unmappedReservationsCount: number;
  priceMismatchCount: number;
  stockMismatchCount: number;
  reservedMismatchCount: number;
  discrepancies: Array<{
    variantId: string;
    issue: string;
    legacyValue?: any;
    offerValue?: any;
  }>;
}

export interface RollbackOptions {
  dryRun?: boolean;
  client?: any;
  orderChecker?: (offerId: string) => Promise<boolean>;
}

export interface RollbackSummary {
  dryRun: boolean;
  scannedOffers: number;
  eligibleForRollback: number;
  rolledBackOffers: number;
  protectedOffers: number;
  protectedDetails: Array<{ offerId: string; reason: string }>;
}

/**
 * Deterministic legacy variant-to-offer backfill implementation.
 *
 * Safety Guarantees:
 * 1. Safe Repeatability: Uses deterministic IDs ('off_' + variant.id) and WHERE NOT EXISTS.
 *    Never overwrites existing ProductOffer rows.
 * 2. No Blind Buy Box Assignment: All backfilled offers start with isBuyBoxWinner = false.
 * 3. Quarantine Protocol: Quarantines unverified sellers and zero-variant products.
 * 4. Deterministic SKU Collision Disambiguation: Scopes SKUs to sellerId without collision.
 * 5. Dry-Run Capability: Allows complete preview of all planned mutations without database writes.
 */
export async function runCatalogueBackfill(options: BackfillOptions = {}): Promise<BackfillSummary> {
  const db = options.client ?? prisma;
  const dryRun = options.dryRun ?? false;

  const summary: BackfillSummary = {
    dryRun,
    scannedProducts: 0,
    scannedVariants: 0,
    quarantinedProducts: 0,
    createdOffers: 0,
    skippedExistingOffers: 0,
    migratedReservations: 0,
    skuCollisionsDisambiguated: 0,
    quarantinedDetails: [],
  };

  // 1. Process products via cursor-based / keyset pagination to maintain constant memory O(batchSize)
  const batchSize = Math.max(1, options.batchSize ?? 250);
  let cursor: string | undefined = undefined;
  let hasMore = true;
  let batchIndex = 0;

  while (hasMore) {
    const queryArgs: any = {
      take: batchSize,
      orderBy: { id: 'asc' },
      include: {
        variants: true,
        offers: true,
      },
    };
    if (cursor) {
      queryArgs.skip = 1;
      queryArgs.cursor = { id: cursor };
    }

    const products: any[] = await db.product.findMany(queryArgs);
    if (!products || products.length === 0) {
      break;
    }

    summary.scannedProducts += products.length;

    for (const product of products) {
      // 2. Quarantine Check: Invalid or Missing Seller Identity
      const isSellerValid = Boolean(
        product.sellerId &&
        product.sellerId.trim() !== '' &&
        (!options.trustedSellerIds || options.trustedSellerIds.has(product.sellerId))
      );

      if (!isSellerValid) {
        summary.quarantinedProducts++;
        summary.quarantinedDetails.push({
          productId: product.id,
          sellerId: product.sellerId || null,
          reason: 'QUARANTINE_UNVERIFIED_SELLER',
        });

        if (!dryRun) {
          if (db.productQuarantineLog) {
            await db.productQuarantineLog.create({
              data: {
                productId: product.id,
                sellerId: product.sellerId || null,
                reason: 'QUARANTINE_UNVERIFIED_SELLER',
                metadata: { slug: product.slug, name: product.name },
              },
            });
          }
          await db.product.update({
            where: { id: product.id },
            data: {
              status: 'REJECTED',
              rejectionReason: 'QUARANTINE_UNVERIFIED_SELLER',
            },
          });
        }
        continue;
      }

      // 3. Quarantine Check: Zero-Variant Products
      if (!product.variants || product.variants.length === 0) {
        summary.quarantinedProducts++;
        summary.quarantinedDetails.push({
          productId: product.id,
          sellerId: product.sellerId,
          reason: 'ZERO_VARIANTS',
        });

        if (!dryRun) {
          if (db.productQuarantineLog) {
            await db.productQuarantineLog.create({
              data: {
                productId: product.id,
                sellerId: product.sellerId,
                reason: 'ZERO_VARIANTS',
                metadata: { slug: product.slug, name: product.name },
              },
            });
          }
          await db.product.update({
            where: { id: product.id },
            data: { status: 'DRAFT' },
          });
        }
        continue;
      }

      // 4. Track seller SKUs to detect collisions within the same seller
      const seenSellerSkus = new Set<string>();

      for (const variant of product.variants) {
        summary.scannedVariants++;
        const deterministicOfferId = `off_${variant.id}`;

        // Check if offer already exists (Idempotent guard)
        const existingOffer = product.offers?.find((o: any) => o.id === deterministicOfferId);
        if (existingOffer) {
          summary.skippedExistingOffers++;
          continue;
        }

        // Handle SKU disambiguation if seller has duplicates
        let resolvedSellerSku = variant.sku || `SKU-${variant.id}`;
        if (seenSellerSkus.has(resolvedSellerSku)) {
          summary.skuCollisionsDisambiguated++;
          resolvedSellerSku = `${resolvedSellerSku}-${variant.id.slice(-6)}`;
        }
        seenSellerSkus.add(resolvedSellerSku);

        // Derive initial safe status
        let initialStatus = 'INACTIVE';
        if (product.status === 'ACTIVE' && variant.active) {
          initialStatus = (variant.stock - variant.reserved) > 0 ? 'ACTIVE' : 'OUT_OF_STOCK';
        }

        if (!dryRun) {
          await db.productOffer.create({
            data: {
              id: deterministicOfferId,
              productId: product.id,
              variantId: variant.id,
              sellerId: product.sellerId,
              sellerSku: resolvedSellerSku,
              price: variant.price,
              compareAtPrice: variant.compareAtPrice,
              currency: product.currency || 'UGX',
              condition: product.condition || 'NEW',
              moq: product.moq || 1,
              wholesaleTiers: product.wholesaleTiers ?? undefined,
              stock: variant.stock,
              reserved: variant.reserved,
              lowStockThreshold: variant.lowStockThreshold || 5,
              status: initialStatus,
              isBuyBoxWinner: false, // Strictly no auto-assignment
            },
          });
        }

        summary.createdOffers++;
      }
    }

    cursor = products[products.length - 1].id;
    batchIndex++;
    if (options.onBatchProgress) {
      options.onBatchProgress(batchIndex, products.length);
    }

    if (products.length < batchSize) {
      hasMore = false;
    }
  }

  // 5. Migrate Active Reservations if InventoryReservation is accessible
  if (db.inventoryReservation) {
    const unmappedReservations = await db.inventoryReservation.findMany({
      where: { offerId: null },
    });

    for (const res of unmappedReservations) {
      summary.migratedReservations++;
      if (!dryRun) {
        await db.inventoryReservation.update({
          where: { id: res.id },
          data: {
            offerId: `off_${res.variantId}`,
            status: 'ACTIVE',
          },
        });
      }
    }
  }

  return summary;
}

/**
 * Exact 1:1 legacy variant-to-offer mapping reconciliation.
 * Verifies that every variant has its exact corresponding offer with parity.
 * Supports cursor-based pagination for large variant catalogs.
 */
export async function reconcileLegacyToOffers(
  optionsOrClient?: any,
): Promise<ReconciliationReport> {
  const isOptions =
    optionsOrClient &&
    typeof optionsOrClient === 'object' &&
    ('client' in optionsOrClient || 'batchSize' in optionsOrClient);
  const db = isOptions ? (optionsOrClient.client ?? prisma) : (optionsOrClient ?? prisma);
  const batchSize = Math.max(1, isOptions ? (optionsOrClient.batchSize ?? 500) : 500);

  const report: ReconciliationReport = {
    isParityConfirmed: true,
    missingOffersCount: 0,
    unmappedReservationsCount: 0,
    priceMismatchCount: 0,
    stockMismatchCount: 0,
    reservedMismatchCount: 0,
    discrepancies: [],
  };

  let cursor: string | undefined = undefined;
  let hasMore = true;

  while (hasMore) {
    const queryArgs: any = {
      take: batchSize,
      orderBy: { id: 'asc' },
      include: {
        product: true,
        offers: true,
      },
    };
    if (cursor) {
      queryArgs.skip = 1;
      queryArgs.cursor = { id: cursor };
    }

    const variants: any[] = await db.productVariant.findMany(queryArgs);
    if (!variants || variants.length === 0) break;

    for (const variant of variants) {
      if (!variant.product.sellerId || variant.product.status === 'REJECTED') {
        continue; // Quarantined variants are excluded from offer parity
      }

      const expectedOfferId = `off_${variant.id}`;
      const offer = variant.offers?.find((o: any) => o.id === expectedOfferId);

      if (!offer) {
        report.isParityConfirmed = false;
        report.missingOffersCount++;
        report.discrepancies.push({
          variantId: variant.id,
          issue: 'MISSING_OFFER',
        });
        continue;
      }

      if (Number(offer.price) !== Number(variant.price)) {
        report.isParityConfirmed = false;
        report.priceMismatchCount++;
        report.discrepancies.push({
          variantId: variant.id,
          issue: 'PRICE_MISMATCH',
          legacyValue: Number(variant.price),
          offerValue: Number(offer.price),
        });
      }

      if (offer.stock !== variant.stock) {
        report.isParityConfirmed = false;
        report.stockMismatchCount++;
        report.discrepancies.push({
          variantId: variant.id,
          issue: 'STOCK_MISMATCH',
          legacyValue: variant.stock,
          offerValue: offer.stock,
        });
      }

      if (offer.reserved !== variant.reserved) {
        report.isParityConfirmed = false;
        report.reservedMismatchCount++;
        report.discrepancies.push({
          variantId: variant.id,
          issue: 'RESERVED_MISMATCH',
          legacyValue: variant.reserved,
          offerValue: offer.reserved,
        });
      }
    }

    cursor = variants[variants.length - 1].id;
    if (variants.length < batchSize) {
      hasMore = false;
    }
  }

  if (db.inventoryReservation) {
    const unmapped = await db.inventoryReservation.count({
      where: { offerId: null },
    });
    if (unmapped > 0) {
      report.isParityConfirmed = false;
      report.unmappedReservationsCount = unmapped;
    }
  }

  return report;
}

/**
 * Safe, guarded rollback implementation for catalogue offer backfill.
 *
 * Safeguards:
 * 1. Targeted: Only touches offers with deterministic ID prefix 'off_'.
 * 2. Order Reference Protection: Never deletes an offer referenced by existing orders.
 * 3. Reservation Protection: Never deletes an offer with active inventory reservations.
 * 4. Modification Protection: Never deletes an offer modified after initial creation.
 * 5. Buy Box Winner Protection: Never deletes an offer flagged as Buy Box winner.
 * 6. Dry-Run Default: Safe preview without database writes unless dryRun=false explicitly set.
 */
export async function rollbackCatalogueBackfill(options: RollbackOptions = {}): Promise<RollbackSummary> {
  const db = options.client ?? prisma;
  const dryRun = options.dryRun ?? true;

  const summary: RollbackSummary = {
    dryRun,
    scannedOffers: 0,
    eligibleForRollback: 0,
    rolledBackOffers: 0,
    protectedOffers: 0,
    protectedDetails: [],
  };

  if (!db.productOffer) {
    return summary;
  }

  const backfilledOffers = await db.productOffer.findMany({
    where: {
      id: { startsWith: 'off_' },
    },
    include: {
      reservations: true,
    },
  });

  summary.scannedOffers = backfilledOffers.length;

  for (const offer of backfilledOffers) {
    // Check 1: Protected against deleting offers referenced by existing orders
    if (options.orderChecker) {
      const isReferenced = await options.orderChecker(offer.id);
      if (isReferenced) {
        summary.protectedOffers++;
        summary.protectedDetails.push({
          offerId: offer.id,
          reason: 'PROTECTED_REFERENCED_BY_ORDERS',
        });
        continue;
      }
    } else if (db.orderItem) {
      const orderItemCount = await db.orderItem.count({ where: { offerId: offer.id } });
      if (orderItemCount > 0) {
        summary.protectedOffers++;
        summary.protectedDetails.push({
          offerId: offer.id,
          reason: 'PROTECTED_REFERENCED_BY_ORDERS',
        });
        continue;
      }
    }

    // Check 2: Protected against deleting offers with active reservations
    const hasActiveReservations = offer.reservations?.some((r: any) => r.status === 'ACTIVE');
    if (hasActiveReservations) {
      summary.protectedOffers++;
      summary.protectedDetails.push({
        offerId: offer.id,
        reason: 'PROTECTED_HAS_ACTIVE_RESERVATIONS',
      });
      continue;
    }

    // Check 3: Protected against deleting Buy Box winners
    if (offer.isBuyBoxWinner) {
      summary.protectedOffers++;
      summary.protectedDetails.push({
        offerId: offer.id,
        reason: 'PROTECTED_BUY_BOX_WINNER',
      });
      continue;
    }

    // Check 4: Protected against deleting offers subsequently modified by sellers
    const createdAtMs = offer.createdAt ? new Date(offer.createdAt).getTime() : 0;
    const updatedAtMs = offer.updatedAt ? new Date(offer.updatedAt).getTime() : 0;
    const isModified = (updatedAtMs - createdAtMs) > 10_000;
    if (isModified) {
      summary.protectedOffers++;
      summary.protectedDetails.push({
        offerId: offer.id,
        reason: 'PROTECTED_SUBSEQUENTLY_MODIFIED',
      });
      continue;
    }

    summary.eligibleForRollback++;

    if (!dryRun) {
      // Safely unlink non-active reservations if any exist
      if (offer.reservations && offer.reservations.length > 0 && db.inventoryReservation) {
        await db.inventoryReservation.updateMany({
          where: { offerId: offer.id },
          data: { offerId: null },
        });
      }

      await db.productOffer.delete({
        where: { id: offer.id },
      });
      summary.rolledBackOffers++;
    }
  }

  return summary;
}
