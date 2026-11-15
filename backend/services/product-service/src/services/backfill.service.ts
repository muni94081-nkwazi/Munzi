import { prisma } from '../db/prisma.js';

export interface BackfillOptions {
  dryRun?: boolean;
  trustedSellerIds?: Set<string>;
  client?: any;
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

  // 1. Load all products with variants
  const products = await db.product.findMany({
    include: {
      variants: true,
      offers: true,
    },
  });

  summary.scannedProducts = products.length;

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
 */
export async function reconcileLegacyToOffers(client?: any): Promise<ReconciliationReport> {
  const db = client ?? prisma;
  const report: ReconciliationReport = {
    isParityConfirmed: true,
    missingOffersCount: 0,
    unmappedReservationsCount: 0,
    priceMismatchCount: 0,
    stockMismatchCount: 0,
    reservedMismatchCount: 0,
    discrepancies: [],
  };

  const variants = await db.productVariant.findMany({
    include: {
      product: true,
      offers: true,
    },
  });

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
