import type { Request, Response } from 'express';
import * as offerService from '../services/offer.service.js';

function fail(res: Response, error: any): void {
  if (error.name === 'ZodError') {
    res.status(422).json({
      success: false,
      message: 'Validation failed',
      issues:  error.issues ?? error.errors,
    });
    return;
  }
  if (error.name === 'SellerNotEligibleError' || error.name === 'NotOfferOwnerError' || error.status === 403) {
    res.status(403).json({ success: false, message: error.message ?? 'Forbidden' });
    return;
  }
  if (error.name === 'OfferNotFoundError' || error.code === 'P2025' || error.status === 404) {
    res.status(404).json({ success: false, message: error.message ?? 'Offer not found' });
    return;
  }
  if (error.name === 'DuplicateSellerSkuError' || error.code === 'P2002' || error.status === 409) {
    res.status(409).json({ success: false, message: error.message ?? 'Seller SKU already in use' });
    return;
  }
  if (error.name === 'InvalidOfferOperationError' || error.status === 422) {
    res.status(422).json({ success: false, message: error.message ?? 'Unprocessable Entity' });
    return;
  }

  const status = typeof error.status === 'number' ? error.status : 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : error.message,
  });
  if (status >= 500) console.error('[product-service] Offer error:', error);
}

function actorId(_req: Request, res: Response): string | null {
  const userId = res.locals?.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }
  return String(userId);
}

// ── Seller Endpoints ──────────────────────────────────────────────────────────

/**
 * POST /api/v1/seller/offers
 * Create a new offer for a canonical product variant.
 */
export async function create(req: Request, res: Response) {
  const sellerId = actorId(req, res);
  if (!sellerId) return;

  try {
    const offer = await offerService.createOffer(sellerId, req.body, res.locals?.roles);
    res.status(201).json({ success: true, data: offer });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * PUT /api/v1/seller/offers/:id
 * Update an offer's price, stock, condition, or status.
 */
export async function update(req: Request, res: Response) {
  const sellerId = actorId(req, res);
  if (!sellerId) return;

  try {
    const offer = await offerService.updateOffer(req.params.id, sellerId, req.body, res.locals?.roles);
    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * DELETE /api/v1/seller/offers/:id
 * Delete an offer (only allowed if no active reservations exist).
 */
export async function remove(req: Request, res: Response) {
  const sellerId = actorId(req, res);
  if (!sellerId) return;

  try {
    const result = await offerService.deleteOffer(req.params.id, sellerId, res.locals?.roles);
    res.status(200).json(result);
  } catch (error) {
    fail(res, error);
  }
}

/**
 * GET /api/v1/seller/offers/:id
 * Get full offer details for the owning seller.
 */
export async function sellerGet(req: Request, res: Response) {
  const sellerId = actorId(req, res);
  if (!sellerId) return;

  try {
    const offer = await offerService.getOfferById(req.params.id, sellerId, res.locals?.roles);
    if (!offer) {
      res.status(404).json({ success: false, message: 'Offer not found' });
      return;
    }
    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * GET /api/v1/seller/offers
 * List all offers belonging to the authenticated seller.
 */
export async function sellerList(req: Request, res: Response) {
  const sellerId = actorId(req, res);
  if (!sellerId) return;

  try {
    const result = await offerService.listSellerOffers(sellerId, {
      status:    req.query.status as string | undefined,
      productId: req.query.productId as string | undefined,
      search:    req.query.search as string | undefined,
      page:      req.query.page ? Number(req.query.page) : undefined,
      limit:     req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    fail(res, error);
  }
}

// ── Public Endpoints ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/products/:id/offers
 * Public list of active offers for a canonical product.
 */
export async function publicListForProduct(req: Request, res: Response) {
  try {
    const result = await offerService.listPublicOffers({
      productId: req.params.id,
      condition: req.query.condition as string | undefined,
      minPrice:  req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice:  req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      page:      req.query.page ? Number(req.query.page) : undefined,
      limit:     req.query.limit ? Number(req.query.limit) : undefined,
      sort:      req.query.sort as any,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * GET /api/v1/products/:id/variants/:variantId/offers
 * Public list of active offers for a specific variant of a canonical product.
 */
export async function publicListForVariant(req: Request, res: Response) {
  try {
    const result = await offerService.listPublicOffers({
      productId: req.params.id,
      variantId: req.params.variantId,
      condition: req.query.condition as string | undefined,
      minPrice:  req.query.minPrice ? Number(req.query.minPrice) : undefined,
      maxPrice:  req.query.maxPrice ? Number(req.query.maxPrice) : undefined,
      page:      req.query.page ? Number(req.query.page) : undefined,
      limit:     req.query.limit ? Number(req.query.limit) : undefined,
      sort:      req.query.sort as any,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * GET /api/v1/offers/:id
 * Public view of a single offer.
 */
export async function publicGet(req: Request, res: Response) {
  try {
    const offer = await offerService.getOfferById(req.params.id, res.locals?.userId, res.locals?.roles);
    if (!offer) {
      res.status(404).json({ success: false, message: 'Offer not found or not available' });
      return;
    }
    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    fail(res, error);
  }
}

// ── Admin Endpoints ───────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/offers
 * Admin listing of offers across all sellers with status and search filters.
 */
export async function adminList(req: Request, res: Response) {
  try {
    const result = await offerService.listAdminOffers({
      status:    req.query.status as string | undefined,
      sellerId:  req.query.sellerId as string | undefined,
      productId: req.query.productId as string | undefined,
      page:      req.query.page ? Number(req.query.page) : undefined,
      limit:     req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    fail(res, error);
  }
}

/**
 * PATCH /api/v1/admin/offers/:id/moderate
 * Admin moderation action (SUSPEND or UNSUSPEND).
 */
export async function adminModerate(req: Request, res: Response) {
  const adminId = actorId(req, res);
  if (!adminId) return;

  try {
    const offer = await offerService.adminModerateOffer(req.params.id, req.body, adminId);
    res.status(200).json({ success: true, data: offer });
  } catch (error) {
    fail(res, error);
  }
}
