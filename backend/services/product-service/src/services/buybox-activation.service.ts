import { prisma } from '../db/prisma.js';
import {
  evaluateBuyBoxForVariant,
  type BuyBoxWinnerResult,
} from './buybox.service.js';
import { refreshProductOfferProjections } from './offer.service.js';

export interface BuyBoxActivationOptions {
  dryRun?: boolean;
  batchSize?: number;
  client?: any;
}

export interface BuyBoxActivationSummary {
  dryRun: boolean;
  scannedVariants: number;
  winnersAssigned: number;
  variantsWithoutWinner: number;
  scannedProducts: number;
  productsWithActiveOffers: number;
  productsWithoutActiveOffers: number;
  winningOfferIds: string[];
}

/**
 * Evaluates Buy Box winners across all canonical ProductVariants and refreshes
 * Product.minOfferPrice, maxOfferPrice, and activeOfferCount across all Products.
 *
 * Idempotent and safe: never mutates offer price, stock, reserved, or seller ownership.
 */
export async function activateBuyBoxAndRefreshProjections(
  options: BuyBoxActivationOptions = {},
): Promise<BuyBoxActivationSummary> {
  const dryRun = options.dryRun !== undefined ? options.dryRun : true;
  const batchSize = options.batchSize && options.batchSize > 0 ? options.batchSize : 100;
  const db = options.client ?? prisma;

  const summary: BuyBoxActivationSummary = {
    dryRun,
    scannedVariants: 0,
    winnersAssigned: 0,
    variantsWithoutWinner: 0,
    scannedProducts: 0,
    productsWithActiveOffers: 0,
    productsWithoutActiveOffers: 0,
    winningOfferIds: [],
  };

  // ── 1. Evaluate Buy Box across all ProductVariants (keyset pagination) ─────
  let variantCursor: string | undefined;
  let hasMoreVariants = true;

  while (hasMoreVariants) {
    const queryArgs: any = {
      take: batchSize,
      orderBy: { id: 'asc' },
      select: { id: true },
    };
    if (variantCursor) {
      queryArgs.skip = 1;
      queryArgs.cursor = { id: variantCursor };
    }

    const variants: Array<{ id: string }> = await db.productVariant.findMany(queryArgs);
    if (variants.length === 0) {
      break;
    }

    for (const variant of variants) {
      summary.scannedVariants++;

      if (dryRun) {
        const activeOffers = await db.productOffer.findMany({
          where: { variantId: variant.id, status: 'ACTIVE' },
          select: { id: true, stock: true, reserved: true },
        });
        const stocked = activeOffers.filter((o: any) => (o.stock - o.reserved) > 0);
        if (stocked.length > 0) {
          summary.winnersAssigned++;
        } else {
          summary.variantsWithoutWinner++;
        }
        continue;
      }

      const result: BuyBoxWinnerResult | null = await evaluateBuyBoxForVariant(variant.id, db);
      if (result?.winningOfferId) {
        summary.winnersAssigned++;
        summary.winningOfferIds.push(result.winningOfferId);
      } else {
        summary.variantsWithoutWinner++;
      }
    }

    variantCursor = variants[variants.length - 1].id;
    if (variants.length < batchSize) {
      hasMoreVariants = false;
    }
  }

  // ── 2. Refresh Product offer projections across all Products ───────────────
  let productCursor: string | undefined;
  let hasMoreProducts = true;

  while (hasMoreProducts) {
    const queryArgs: any = {
      take: batchSize,
      orderBy: { id: 'asc' },
      select: { id: true },
    };
    if (productCursor) {
      queryArgs.skip = 1;
      queryArgs.cursor = { id: productCursor };
    }

    const products: Array<{ id: string }> = await db.product.findMany(queryArgs);
    if (products.length === 0) {
      break;
    }

    for (const product of products) {
      summary.scannedProducts++;

      const activeCount = await db.productOffer.count({
        where: { productId: product.id, status: 'ACTIVE' },
      });

      if (!dryRun) {
        await refreshProductOfferProjections(product.id, db);
      }

      if (activeCount > 0) {
        summary.productsWithActiveOffers++;
      } else {
        summary.productsWithoutActiveOffers++;
      }
    }

    productCursor = products[products.length - 1].id;
    if (products.length < batchSize) {
      hasMoreProducts = false;
    }
  }

  return summary;
}
