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
 * 2. In-stock availability (0 to 200 pts): Math.min((stock - reserved) / 10, 1.0) * 200
 * 3. Condition priority (0 to 150 pts): NEW = 150, USED_LIKE_NEW = 100, etc.
 * 4. Seller trust & verification (0 to 50 pts): Verified merchant (+30), Standing GOOD (+20)
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

// ── Buy Box Evaluation Methods ────────────────────────────────────────────────

/**
 * Evaluates and awards the Buy Box for a specific canonical product variant.
 *
 * Algorithm:
 * 1. Fetches all offers for the given variant.
 * 2. Filters to ACTIVE offers with sellable stock > 0.
 * 3. Verifies seller eligibility fail-closed (disqualifying ineligible/suspended sellers).
 * 4. Finds minimum price among eligible offers.
 * 5. Scores each candidate across price, stock, condition, and seller standing.
 * 6. Promotes top-scoring offer to isBuyBoxWinner: true and demotes all others to false.
 */
export async function evaluateBuyBoxForVariant(
  variantId: string,
  client: any = prisma,
): Promise<BuyBoxWinnerResult | null> {
  if (!variantId) return null;

  const offers = await client.productOffer.findMany({
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

  // 1. Initial filter: ACTIVE and sellable stock > 0
  const activeStockedOffers = offers.filter(
    (o: any) => o.status === 'ACTIVE' && (o.stock - o.reserved) > 0,
  );

  if (activeStockedOffers.length === 0) {
    // Demote any previously assigned winner
    await client.productOffer.updateMany({
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

  // 2. Verify Seller Eligibility for all candidates (cached per seller)
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
    await client.productOffer.updateMany({
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

  // 3. Find minimum price among eligible candidates
  const minPrice = Math.min(...eligibleCandidates.map((c) => Number(c.offer.price)));

  // 4. Score each candidate
  const scoredCandidates: BuyBoxCandidate[] = eligibleCandidates.map(({ offer, eligibility }) => {
    const { score, breakdown } = calculateBuyBoxScore(offer, minPrice, eligibility);
    return {
      offer,
      score,
      breakdown,
    };
  });

  // 5. Rank candidates: Score DESC, createdAt ASC (earlier listed wins tie), id ASC
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

  // 6. Update database atomically
  // Demote previous winners that are not the current winner
  await client.productOffer.updateMany({
    where: {
      variantId,
      isBuyBoxWinner: true,
      NOT: { id: winner.offer.id },
    },
    data: { isBuyBoxWinner: false },
  });

  // Promote current winner if not already flagged
  if (!winner.offer.isBuyBoxWinner) {
    await client.productOffer.update({
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
