import { prisma } from '../db/prisma.js';
import { verifySellerEligibility, type SellerEligibilityResult } from './seller-eligibility.service.js';

// ── Types & Interfaces ─────────────────────────────────────────────────────────

export interface BuyBoxScoreBreakdown {
  priceScore: number;       // 0 to 600
  stockScore: number;       // 0 to 200
  conditionScore: number;   // 0 to 150
  sellerTrustScore: number; // 0 to 50
  totalScore: number;       // 0 to 1000
}

export interface BuyBoxCandidate {
  offer: any;
  score: number;
  breakdown: BuyBoxScoreBreakdown;
}

export interface BuyBoxWinnerResult {
  variantId: string;
  productId: string;
  winningOfferId: string | null;
  winner: any | null;
  score: number;
  breakdown?: BuyBoxScoreBreakdown;
  evaluatedCount: number;
  eligibleCount: number;
}

// ── Public Sanitized Types ─────────────────────────────────────────────────────

export interface PublicBuyBoxOffer {
  id: string;
  productId: string;
  variantId: string;
  sellerId: string;
  price: number;
  compareAtPrice: number | null;
  currency: string;
  condition: string;
  conditionNote: string | null;
  moq: number;
  wholesaleTiers: any;
  inStock: boolean;
  isBuyBoxWinner: boolean;
  createdAt: Date | string;
}

export interface PublicBuyBoxResult {
  variantId: string;
  productId: string;
  winningOfferId: string | null;
  hasWinner: boolean;
  inStock: boolean;
  winner: PublicBuyBoxOffer | null;
}

// ── Condition Weighting ───────────────────────────────────────────────────────

export const CONDITION_WEIGHTS: Record<string, number> = {
  NEW:           150,
  LIKE_NEW:      100,
  USED_LIKE_NEW: 100,
  REFURBISHED:   80,
  OPEN_BOX:      80,
  USED_GOOD:     50,
  USED_FAIR:     20,
  FOR_PARTS:     0,
};

// ── Scoring Engine ────────────────────────────────────────────────────────────

/**
 * Calculate the Buy Box score (0 - 1000) for a competing candidate offer.
 *
 * Scoring factors:
 * 1. Landed price (0 to 600 pts): (minPrice / offerPrice) * 600
 *    [ROADMAP NOTE]: Shipping estimation is not yet integrated. Full landed cost
 *    (unit price + estimated standard shipping to customer destination) will be
 *    incorporated once shipping-service rate APIs are exposed.
 * 2. In-stock availability (0 to 200 pts): Math.min((stock - reserved) / 10, 1.0) * 200
 * 3. Condition priority (0 to 150 pts): NEW = 150, USED_LIKE_NEW = 100, etc.
 * 4. Seller trust & verification (0 to 50 pts): Verified merchant (+30), Standing GOOD (+20)
 *    [ROADMAP NOTE]: Quantitative customer ratings (1-5 stars from review-service),
 *    historical seller cancellation rates, and order defect rates (ODR) are planned
 *    for post-Gate 3B integration.
 * [ROADMAP NOTE]: Fulfillment speed (delivery SLA / dispatch window) is not yet
 * factored into scoring.
 *
 * [GATE 3G MIGRATION NOTE]: The PostgreSQL partial unique index:
 *   CREATE UNIQUE INDEX "idx_product_offer_single_buybox_winner"
 *   ON "ProductOffer" ("variantId")
 *   WHERE "isBuyBoxWinner" = true;
 * is documented for formal application during Gate 3G (Stage 2 & 3 Migration & Backfill).
 * In Gate 3B.1, single-winner integrity is strictly enforced at runtime via variant-keyed
 * mutex serialization, transactional execution, and PostgreSQL row/advisory locking.
 */
export function calculateBuyBoxScore(
  offer: {
    price: number | string | any;
    stock: number;
    reserved: number;
    condition: string;
  },
  minPrice: number,
  sellerEligibility?: SellerEligibilityResult | null,
): { score: number; breakdown: BuyBoxScoreBreakdown } {
  const offerPrice = Number(offer.price);
  const sellableStock = Math.max(0, offer.stock - offer.reserved);

  // If price is invalid or sellable stock is 0, score is 0
  if (offerPrice <= 0 || sellableStock <= 0) {
    const zeroBreakdown: BuyBoxScoreBreakdown = {
      priceScore: 0,
      stockScore: 0,
      conditionScore: 0,
      sellerTrustScore: 0,
      totalScore: 0,
    };
    return { score: 0, breakdown: zeroBreakdown };
  }

  // 1. Price Score (0 - 600 pts)
  const priceScore = Math.round((minPrice / offerPrice) * 600 * 100) / 100;

  // 2. Stock Availability Score (0 - 200 pts; 10+ units receives maximum 200 pts)
  const stockScore = Math.round(Math.min(sellableStock / 10, 1.0) * 200 * 100) / 100;

  // 3. Condition Priority Score (0 - 150 pts)
  const conditionScore = CONDITION_WEIGHTS[offer.condition] ?? 0;

  // 4. Seller Trust Score (0 - 50 pts)
  let sellerTrustScore = 0;
  if (sellerEligibility && sellerEligibility.isEligible) {
    if (sellerEligibility.isVerifiedMerchant) {
      sellerTrustScore += 30;
    }
    if (sellerEligibility.standing === 'GOOD') {
      sellerTrustScore += 20;
    } else if (sellerEligibility.standing === 'AT_RISK') {
      sellerTrustScore += 5;
    }
  } else if (!sellerEligibility) {
    // Default baseline if eligibility service wasn't passed or checked
    sellerTrustScore = 20;
  }

  const totalScore = Math.round((priceScore + stockScore + conditionScore + sellerTrustScore) * 100) / 100;

  return {
    score: totalScore,
    breakdown: {
      priceScore,
      stockScore,
      conditionScore,
      sellerTrustScore,
      totalScore,
    },
  };
}

// ── Public Sanitization Helpers ────────────────────────────────────────────────

/**
 * Convert an internal candidate offer to a public shopper view.
 * Removes raw warehouse stock, cart reservations, and internal seller SKU.
 */
export function toPublicBuyBoxOffer(offer: any): PublicBuyBoxOffer | null {
  if (!offer) return null;
  const sellable = (Number(offer.stock) - Number(offer.reserved ?? 0)) > 0;
  return {
    id:             offer.id,
    productId:      offer.productId,
    variantId:      offer.variantId,
    sellerId:       offer.sellerId,
    price:          Number(offer.price),
    compareAtPrice: offer.compareAtPrice !== null && offer.compareAtPrice !== undefined ? Number(offer.compareAtPrice) : null,
    currency:       offer.currency || 'UGX',
    condition:      offer.condition,
    conditionNote:  offer.conditionNote ?? null,
    moq:            offer.moq ?? 1,
    wholesaleTiers: offer.wholesaleTiers ?? null,
    inStock:        sellable,
    isBuyBoxWinner: Boolean(offer.isBuyBoxWinner),
    createdAt:      offer.createdAt,
  };
}

/**
 * Convert an internal evaluation result to a public response.
 * Completely strips score, breakdown, sellerTrustScore, and evaluation counts.
 */
export function toPublicBuyBoxResult(result: BuyBoxWinnerResult | null): PublicBuyBoxResult | null {
  if (!result) return null;
  const publicOffer = toPublicBuyBoxOffer(result.winner);
  return {
    variantId:      result.variantId,
    productId:      result.productId,
    winningOfferId: result.winningOfferId,
    hasWinner:      Boolean(result.winningOfferId),
    inStock:        Boolean(publicOffer?.inStock),
    winner:         publicOffer,
  };
}

// ── Concurrency & Serialization Controls ──────────────────────────────────────

// In-process variant lock queue to serialize concurrent evaluations for the same variant
const variantLocks = new Map<string, Promise<void>>();

export async function acquireVariantLock(variantId: string): Promise<() => void> {
  while (variantLocks.has(variantId)) {
    try {
      await variantLocks.get(variantId);
    } catch {
      // Ignore errors from preceding lock holder
    }
  }

  let releaseLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = () => {
      variantLocks.delete(variantId);
      resolve();
    };
  });

  variantLocks.set(variantId, lockPromise);
  return releaseLock;
}

export async function runWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isTransient =
        err?.code === '40P01' || // PostgreSQL deadlock_detected
        err?.code === '40001' || // PostgreSQL serialization_failure
        err?.code === 'P2034' || // Prisma transaction conflict
        err?.message?.includes('deadlock') ||
        err?.message?.includes('could not serialize');

      if (attempt < maxRetries && isTransient) {
        const jitter = Math.random() * 50;
        const delay = Math.min(50 * Math.pow(2, attempt) + jitter, 400);
        await new Promise((res) => setTimeout(res, delay));
        continue;
      }
      throw err;
    }
  }
}

// ── Buy Box Evaluation Methods ────────────────────────────────────────────────

/**
 * Internal core execution of Buy Box evaluation within an isolated transaction.
 */
async function executeEvaluation(
  variantId: string,
  tx: any,
): Promise<BuyBoxWinnerResult | null> {
  // 1. PostgreSQL advisory xact lock and row-level lock
  if (typeof tx.$executeRaw === 'function') {
    // Namespace 0x4D554E49 ('MUNI') = 1297436233
    try {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(1297436233, hashtext(${variantId}))
      `;
    } catch {
      // non-fatal on sqlite / test mocks
    }
  }

  if (typeof tx.$queryRaw === 'function') {
    try {
      await tx.$queryRaw`
        SELECT id FROM "ProductVariant"
        WHERE id = ${variantId}
        FOR UPDATE
      `;
    } catch {
      // non-fatal on sqlite / test mocks
    }
  }

  // 2. Fetch all candidate offers for this variant
  const offers = await tx.productOffer.findMany({
    where: { variantId },
    select: {
      id:             true,
      productId:      true,
      variantId:      true,
      sellerId:       true,
      sellerSku:      true,
      price:          true,
      stock:          true,
      reserved:       true,
      condition:      true,
      status:         true,
      isBuyBoxWinner: true,
      createdAt:      true,
    },
    orderBy: { createdAt: 'asc' },
  });

  if (!offers || offers.length === 0) {
    return null;
  }

  const productId = offers[0].productId;

  // 3. Filter to ACTIVE offers with sellable stock > 0
  const activeStockedOffers = offers.filter(
    (o: any) => o.status === 'ACTIVE' && (o.stock - o.reserved) > 0,
  );

  if (activeStockedOffers.length === 0) {
    // Demote any previously assigned winner
    await tx.productOffer.updateMany({
      where: {
        variantId,
        isBuyBoxWinner: true,
      },
      data: { isBuyBoxWinner: false },
    });

    return {
      variantId,
      productId,
      winningOfferId: null,
      winner: null,
      score: 0,
      evaluatedCount: offers.length,
      eligibleCount: 0,
    };
  }

  // 4. Verify Seller Eligibility for all candidates (cached per seller)
  const sellerEligibilityCache = new Map<string, SellerEligibilityResult>();
  const eligibleCandidates: Array<{ offer: any; eligibility: SellerEligibilityResult }> = [];

  for (const offer of activeStockedOffers) {
    let eligibility = sellerEligibilityCache.get(offer.sellerId);
    if (!eligibility) {
      eligibility = await verifySellerEligibility(offer.sellerId);
      sellerEligibilityCache.set(offer.sellerId, eligibility);
    }

    if (eligibility.isEligible && eligibility.standing !== 'SUSPENDED') {
      eligibleCandidates.push({ offer, eligibility });
    }
  }

  if (eligibleCandidates.length === 0) {
    // All candidates failed eligibility: demote all
    await tx.productOffer.updateMany({
      where: {
        variantId,
        isBuyBoxWinner: true,
      },
      data: { isBuyBoxWinner: false },
    });

    return {
      variantId,
      productId,
      winningOfferId: null,
      winner: null,
      score: 0,
      evaluatedCount: offers.length,
      eligibleCount: 0,
    };
  }

  // 5. Find minimum price among eligible candidates
  const minPrice = Math.min(...eligibleCandidates.map((c) => Number(c.offer.price)));

  // 6. Score each candidate
  const scoredCandidates: BuyBoxCandidate[] = eligibleCandidates.map(({ offer, eligibility }) => {
    const { score, breakdown } = calculateBuyBoxScore(offer, minPrice, eligibility);
    return {
      offer,
      score,
      breakdown,
    };
  });

  // 7. Rank candidates: Score DESC, createdAt ASC (earlier listed wins tie), id ASC
  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    const timeA = new Date(a.offer.createdAt).getTime();
    const timeB = new Date(b.offer.createdAt).getTime();
    if (timeA !== timeB) {
      return timeA - timeB;
    }
    return String(a.offer.id).localeCompare(String(b.offer.id));
  });

  const winner = scoredCandidates[0];

  // 8. Update database atomically:
  // Demote previous winners that are not the current winner
  await tx.productOffer.updateMany({
    where: {
      variantId,
      isBuyBoxWinner: true,
      NOT: { id: winner.offer.id },
    },
    data: { isBuyBoxWinner: false },
  });

  // Promote current winner if not already flagged
  if (!winner.offer.isBuyBoxWinner) {
    await tx.productOffer.update({
      where: { id: winner.offer.id },
      data: { isBuyBoxWinner: true },
    });
  }

  return {
    variantId,
    productId,
    winningOfferId: winner.offer.id,
    winner: winner.offer,
    score: winner.score,
    breakdown: winner.breakdown,
    evaluatedCount: offers.length,
    eligibleCount: eligibleCandidates.length,
  };
}

/**
 * Evaluates and awards the Buy Box for a specific canonical product variant.
 * Enforces in-process mutex locking and transactional isolation.
 */
export async function evaluateBuyBoxForVariant(
  variantId: string,
  client: any = prisma,
): Promise<BuyBoxWinnerResult | null> {
  if (!variantId) return null;

  const releaseLock = await acquireVariantLock(variantId);

  try {
    const isInsideTransaction = client !== prisma && typeof client.$transaction !== 'function';

    if (isInsideTransaction) {
      return await executeEvaluation(variantId, client);
    }

    const runner = typeof (client as any).$transaction === 'function'
      ? (fn: (tx: any) => Promise<any>) => (client as any).$transaction(fn, {
          maxWait: 5000,
          timeout: 10000,
        })
      : (fn: (tx: any) => Promise<any>) => fn(client);

    return await runWithRetry(async () => {
      return await runner(async (tx: any) => {
        return await executeEvaluation(variantId, tx);
      });
    });
  } finally {
    releaseLock();
  }
}

/**
 * Evaluates and awards the Buy Box for all variants of a canonical product.
 */
export async function evaluateBuyBoxForProduct(
  productId: string,
  client: any = prisma,
): Promise<BuyBoxWinnerResult[]> {
  if (!productId) return [];

  const variants = await client.productVariant.findMany({
    where: { productId },
    select: { id: true },
  });

  const results: BuyBoxWinnerResult[] = [];
  for (const variant of variants) {
    const result = await evaluateBuyBoxForVariant(variant.id, client);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

/**
 * Re-evaluates Buy Box for all variants where a given seller has active offers.
 * Used when a seller's eligibility, verification, or standing changes.
 */
export async function recalculateBuyBoxForSeller(
  sellerId: string,
  client: any = prisma,
): Promise<BuyBoxWinnerResult[]> {
  if (!sellerId) return [];

  const sellerOffers = await client.productOffer.findMany({
    where: { sellerId },
    select: { variantId: true },
    distinct: ['variantId'],
  });

  const results: BuyBoxWinnerResult[] = [];
  for (const { variantId } of sellerOffers) {
    const result = await evaluateBuyBoxForVariant(variantId, client);
    if (result) {
      results.push(result);
    }
  }

  return results;
}
