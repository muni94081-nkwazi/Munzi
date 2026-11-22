/**
 * Phase 2C.2 — ProductOffer Controller Unit & Route Tests
 *
 * Tests the HTTP controllers for:
 * - POST /api/v1/seller/offers (create)
 * - PUT /api/v1/seller/offers/:id (update)
 * - DELETE /api/v1/seller/offers/:id (delete)
 * - GET /api/v1/seller/offers/:id (seller get)
 * - GET /api/v1/seller/offers (seller list)
 * - GET /api/v1/products/:id/offers (public list)
 * - GET /api/v1/products/:id/variants/:variantId/offers (public list for variant)
 * - GET /api/v1/offers/:id (public get)
 * - PATCH /api/v1/admin/offers/:id/moderate (admin suspension)
 * - GET /api/v1/admin/offers (admin list)
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Request, Response } from 'express';

// ── Mock Offer Service ────────────────────────────────────────────────────────
const { toPublicBuyBoxResult, toPublicBuyBoxOffer } = await import('../services/buybox.service.js');

const mockOfferService = {
  createOffer:                jest.fn<(...args: any[]) => any>(),
  updateOffer:                jest.fn<(...args: any[]) => any>(),
  deleteOffer:                jest.fn<(...args: any[]) => any>(),
  getOfferById:               jest.fn<(...args: any[]) => any>(),
  listPublicOffers:           jest.fn<(...args: any[]) => any>(),
  listSellerOffers:           jest.fn<(...args: any[]) => any>(),
  listAdminOffers:            jest.fn<(...args: any[]) => any>(),
  adminModerateOffer:         jest.fn<(...args: any[]) => any>(),
  evaluateBuyBoxForProduct:   jest.fn<(...args: any[]) => any>(),
  evaluateBuyBoxForVariant:   jest.fn<(...args: any[]) => any>(),
  recalculateBuyBoxForSeller: jest.fn<(...args: any[]) => any>(),
  toPublicBuyBoxResult,
  toPublicBuyBoxOffer,
};

jest.unstable_mockModule('../services/offer.service.js', () => mockOfferService);

const offerController = await import('../controllers/offer.controller.js');

// ── Mock Request & Response Helper ────────────────────────────────────────────
function mockReqRes(options: {
  userId?:  string;
  roles?:   string[];
  params?:  Record<string, string>;
  query?:   Record<string, string>;
  body?:    any;
} = {}) {
  const jsonSpy   = jest.fn();
  const statusSpy = jest.fn().mockReturnThis();

  const res: any = {
    locals: {
      userId: options.userId,
      roles:  options.roles ?? ['ROLE_SELLER'],
    },
    status: statusSpy,
    json:   jsonSpy,
  };

  const req: any = {
    params:  options.params ?? {},
    query:   options.query ?? {},
    body:    options.body ?? {},
    headers: {},
  };

  return { req, res, jsonSpy, statusSpy };
}

// ── Reset Mocks ───────────────────────────────────────────────────────────────
beforeEach(() => {
  jest.resetAllMocks();
});

afterEach(() => {
  jest.clearAllMocks();
});

// ── 1. POST /api/v1/seller/offers (Create) ────────────────────────────────────

describe('offerController.create', () => {
  it('returns 401 when userId is missing from res.locals', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({ userId: undefined });

    await offerController.create(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Unauthorized' }),
    );
    expect(mockOfferService.createOffer).not.toHaveBeenCalled();
  });

  it('creates an offer successfully and returns 201', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      body: {
        productId: 'prod-1',
        variantId: 'var-1',
        price:     50000,
        stock:     10,
      },
    });

    const createdOffer = { id: 'off-new', price: 50000, sellerId: 'seller-123' };
    mockOfferService.createOffer.mockResolvedValueOnce(createdOffer);

    await offerController.create(req as Request, res as Response);

    expect(mockOfferService.createOffer).toHaveBeenCalledWith(
      'seller-123',
      req.body,
      ['ROLE_SELLER'],
    );
    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(jsonSpy).toHaveBeenCalledWith({ success: true, data: createdOffer });
  });

  it('maps ZodError to 422 with validation issues', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      body:   { price: -10 },
    });

    const zodError: any = new Error('Validation failed');
    zodError.name = 'ZodError';
    zodError.issues = [{ path: ['price'], message: 'Price must be positive' }];
    mockOfferService.createOffer.mockRejectedValueOnce(zodError);

    await offerController.create(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(422);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Validation failed' }),
    );
  });

  it('maps SellerNotEligibleError to 403 Forbidden', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({ userId: 'seller-unverified' });

    const forbiddenError: any = new Error('Seller is not eligible to create offers');
    forbiddenError.name = 'SellerNotEligibleError';
    forbiddenError.status = 403;
    mockOfferService.createOffer.mockRejectedValueOnce(forbiddenError);

    await offerController.create(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/not eligible/i) }),
    );
  });
});

// ── 2. PUT /api/v1/seller/offers/:id (Update) ──────────────────────────────────

describe('offerController.update', () => {
  it('returns 200 on successful offer update', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      params: { id: 'off-1' },
      body:   { price: 45000 },
    });

    const updatedOffer = { id: 'off-1', price: 45000 };
    mockOfferService.updateOffer.mockResolvedValueOnce(updatedOffer);

    await offerController.update(req as Request, res as Response);

    expect(mockOfferService.updateOffer).toHaveBeenCalledWith(
      'off-1',
      'seller-123',
      { price: 45000 },
      ['ROLE_SELLER'],
    );
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({ success: true, data: updatedOffer });
  });

  it('maps DuplicateSellerSkuError to 409 Conflict', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      params: { id: 'off-1' },
      body:   { sellerSku: 'DUPE-SKU' },
    });

    const dupeError: any = new Error('Seller SKU already in use by this seller.');
    dupeError.name = 'DuplicateSellerSkuError';
    dupeError.status = 409;
    mockOfferService.updateOffer.mockRejectedValueOnce(dupeError);

    await offerController.update(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/Seller SKU already in use/i) }),
    );
  });

  it('maps NotOfferOwnerError to 403 Forbidden', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-hacker',
      params: { id: 'off-victim' },
      body:   { price: 100 },
    });

    const authError: any = new Error('You do not have permission to modify this offer.');
    authError.name = 'NotOfferOwnerError';
    authError.status = 403;
    mockOfferService.updateOffer.mockRejectedValueOnce(authError);

    await offerController.update(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/permission/i) }),
    );
  });
});

// ── 3. DELETE /api/v1/seller/offers/:id (Remove) ──────────────────────────────

describe('offerController.remove', () => {
  it('returns 200 on successful deletion', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      params: { id: 'off-1' },
    });

    mockOfferService.deleteOffer.mockResolvedValueOnce({ success: true });

    await offerController.remove(req as Request, res as Response);

    expect(mockOfferService.deleteOffer).toHaveBeenCalledWith('off-1', 'seller-123', ['ROLE_SELLER']);
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({ success: true });
  });

  it('maps active reservation block to 422 Unprocessable Entity', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'seller-123',
      params: { id: 'off-1' },
    });

    const opError: any = new Error('Cannot delete offer with active inventory reservations');
    opError.name = 'InvalidOfferOperationError';
    opError.status = 422;
    mockOfferService.deleteOffer.mockRejectedValueOnce(opError);

    await offerController.remove(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(422);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringMatching(/Cannot delete offer|Unprocessable Entity/i) }),
    );
  });
});

// ── 4. Public Endpoints ───────────────────────────────────────────────────────

describe('offerController public endpoints', () => {
  it('publicListForProduct returns 200 with sanitized offer list', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      params: { id: 'prod-1' },
      query:  { condition: 'NEW', minPrice: '1000' },
    });

    const publicResult = {
      total:      1,
      page:       1,
      limit:      20,
      totalPages: 1,
      offers:     [{ id: 'off-1', price: 15000, condition: 'NEW' }],
    };
    mockOfferService.listPublicOffers.mockResolvedValueOnce(publicResult);

    await offerController.publicListForProduct(req as Request, res as Response);

    expect(mockOfferService.listPublicOffers).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod-1',
        condition: 'NEW',
        minPrice:  1000,
      }),
    );
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: true, total: 1 }));
  });

  it('publicGet returns 404 if offer is not found or inactive', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      params: { id: 'off-nonexistent' },
    });

    mockOfferService.getOfferById.mockResolvedValueOnce(null);

    await offerController.publicGet(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: 'Offer not found or not available' }),
    );
  });
});

// ── 5. Admin Endpoints ────────────────────────────────────────────────────────

describe('offerController admin endpoints', () => {
  it('adminModerate returns 200 on suspension action', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'admin-super',
      roles:  ['ROLE_ADMIN'],
      params: { id: 'off-bad' },
      body:   { action: 'SUSPEND', reason: 'Counterfeit reports' },
    });

    const suspendedOffer = { id: 'off-bad', status: 'SUSPENDED' };
    mockOfferService.adminModerateOffer.mockResolvedValueOnce(suspendedOffer);

    await offerController.adminModerate(req as Request, res as Response);

    expect(mockOfferService.adminModerateOffer).toHaveBeenCalledWith(
      'off-bad',
      { action: 'SUSPEND', reason: 'Counterfeit reports' },
      'admin-super',
    );
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith({ success: true, data: suspendedOffer });
  });

  it('adminList returns 200 with paginated offers across all sellers', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'admin-super',
      roles:  ['ROLE_ADMIN'],
      query:  { status: 'SUSPENDED', page: '1' },
    });

    const adminResult = { total: 2, page: 1, limit: 20, totalPages: 1, offers: [] };
    mockOfferService.listAdminOffers.mockResolvedValueOnce(adminResult);

    await offerController.adminList(req as Request, res as Response);

    expect(mockOfferService.listAdminOffers).toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledWith(200);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: true, total: 2 }));
  });
});

// ── 6. Buy Box Endpoints ──────────────────────────────────────────────────────

describe('offerController Buy Box endpoints', () => {
  const rawEvaluationResult = {
    variantId: 'var-1',
    productId: 'prod-123',
    winningOfferId: 'off-1',
    winner: {
      id:             'off-1',
      productId:      'prod-123',
      variantId:      'var-1',
      sellerId:       'seller-alpha',
      sellerSku:      'PRIVATE-ALPHA-SKU-999',
      price:          250000,
      compareAtPrice: 300000,
      currency:       'UGX',
      condition:      'NEW',
      conditionNote:  'Factory sealed',
      moq:            1,
      wholesaleTiers: null,
      stock:          50,
      reserved:       12,
      status:         'ACTIVE',
      isBuyBoxWinner: true,
      createdAt:      new Date('2026-01-01T00:00:00Z'),
    },
    score: 950,
    breakdown: {
      priceScore:       600,
      stockScore:       200,
      conditionScore:   150,
      sellerTrustScore: 50,
      totalScore:       950,
    },
    evaluatedCount: 5,
    eligibleCount:   3,
  };

  it('getBuyBoxForProduct returns 200 with sanitized array of variant winners', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      params: { id: 'prod-123' },
    });

    mockOfferService.evaluateBuyBoxForProduct.mockResolvedValueOnce([rawEvaluationResult]);

    await offerController.getBuyBoxForProduct(req as Request, res as Response);

    expect(mockOfferService.evaluateBuyBoxForProduct).toHaveBeenCalledWith('prod-123');
    expect(statusSpy).toHaveBeenCalledWith(200);

    const callArg = jsonSpy.mock.calls[0][0] as any;
    expect(callArg.success).toBe(true);
    expect(callArg.data).toHaveLength(1);

    const publicItem = callArg.data[0];
    expect(publicItem.variantId).toBe('var-1');
    expect(publicItem.winningOfferId).toBe('off-1');
    expect(publicItem.hasWinner).toBe(true);
    expect(publicItem.inStock).toBe(true);
    expect(publicItem.winner.price).toBe(250000);

    // Assert sensitive fields do not leak in public product Buy Box
    expect(publicItem.score).toBeUndefined();
    expect(publicItem.breakdown).toBeUndefined();
    expect(publicItem.evaluatedCount).toBeUndefined();
    expect(publicItem.winner.stock).toBeUndefined();
    expect(publicItem.winner.reserved).toBeUndefined();
    expect(publicItem.winner.sellerSku).toBeUndefined();
  });

  it('getBuyBoxForVariant returns 200 with sanitized winner and strips private inventory/trust metrics', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      params: { variantId: 'var-1' },
    });

    mockOfferService.evaluateBuyBoxForVariant.mockResolvedValueOnce(rawEvaluationResult);

    await offerController.getBuyBoxForVariant(req as Request, res as Response);

    expect(mockOfferService.evaluateBuyBoxForVariant).toHaveBeenCalledWith('var-1');
    expect(statusSpy).toHaveBeenCalledWith(200);

    const callArg = jsonSpy.mock.calls[0][0] as any;
    expect(callArg.success).toBe(true);
    const data = callArg.data;

    // Public shopper display fields MUST be present
    expect(data.variantId).toBe('var-1');
    expect(data.productId).toBe('prod-123');
    expect(data.winningOfferId).toBe('off-1');
    expect(data.hasWinner).toBe(true);
    expect(data.inStock).toBe(true);
    expect(data.winner.price).toBe(250000);
    expect(data.winner.condition).toBe('NEW');
    expect(data.winner.isBuyBoxWinner).toBe(true);

    // Sensitive merchant / internal fields MUST NOT leak
    expect(data.winner.stock).toBeUndefined();
    expect(data.winner.reserved).toBeUndefined();
    expect(data.winner.sellerSku).toBeUndefined();
    expect(data.winner.status).toBeUndefined();
    expect(data.score).toBeUndefined();
    expect(data.breakdown).toBeUndefined();
    expect(data.evaluatedCount).toBeUndefined();
    expect(data.eligibleCount).toBeUndefined();
  });

  it('getBuyBoxForVariant returns 404 when no offers exist for variant', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      params: { variantId: 'var-empty' },
    });

    mockOfferService.evaluateBuyBoxForVariant.mockResolvedValueOnce(null);

    await offerController.getBuyBoxForVariant(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'No offers found for variant' }));
  });

  it('adminRecalculateBuyBox returns 200 on recalculation by variantId with full diagnostic data', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'admin-1',
      roles:  ['ROLE_ADMIN'],
      body:   { variantId: 'var-1' },
    });

    mockOfferService.evaluateBuyBoxForVariant.mockResolvedValueOnce(rawEvaluationResult);

    await offerController.adminRecalculateBuyBox(req as Request, res as Response);

    expect(mockOfferService.evaluateBuyBoxForVariant).toHaveBeenCalledWith('var-1');
    expect(statusSpy).toHaveBeenCalledWith(200);
    // Admins retain diagnostic scoring and count data
    expect(jsonSpy).toHaveBeenCalledWith({ success: true, data: rawEvaluationResult });
  });

  it('adminRecalculateBuyBox returns 400 when no target identifier is provided', async () => {
    const { req, res, statusSpy, jsonSpy } = mockReqRes({
      userId: 'admin-1',
      roles:  ['ROLE_ADMIN'],
      body:   {},
    });

    await offerController.adminRecalculateBuyBox(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(jsonSpy).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Must provide productId, variantId, or sellerId' }));
  });
});
