import type { Request, Response } from 'express';
import * as variantService from '../services/variant.service.js';

function fail(res: Response, error: any): void {
  if (error.name === 'ZodError') {
    res.status(422).json({ success: false, message: 'Validation failed', issues: error.issues });
    return;
  }
  if (error.name === 'NotProductOwnerError' || error.status === 403) {
    res.status(403).json({ success: false, message: error.message ?? 'Forbidden' });
    return;
  }
  if (error.name === 'VariantNotFoundError' || error.code === 'P2025' || error.status === 404) {
    res.status(404).json({ success: false, message: error.message ?? 'Variant not found' });
    return;
  }
  const status = typeof error.status === 'number' ? error.status : 500;
  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Internal server error' : error.message,
  });
  if (status >= 500) console.error('[product-service] Variant error:', error);
}

function actorId(_req: Request, res: Response): string | null {
  const userId = res.locals.userId;
  if (!userId) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
    return null;
  }
  return String(userId);
}

/**
 * GET /api/v1/products/variants/:variantId
 *
 * Single-variant lookup used by checkout-service to price a cart line against
 * the catalogue. A 404 here is a normal outcome (variant delisted, product
 * un-published mid-checkout), not an error — the caller reports it to the
 * customer as "no longer available" and removes the line.
 */
export async function getVariantById(req: Request, res: Response) {
  try {
    // `id` is present only on the nested route; when it is, the variant must
    // belong to that product or this 404s.
    const variant = await variantService.getVariantById(req.params.variantId, req.params.id);
    if (!variant) {
      res.status(404).json({ success: false, message: 'Variant not found or not available for sale' });
      return;
    }
    res.status(200).json({ success: true, data: variant });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function getVariants(req: Request, res: Response) {
  try {
    const variants = await variantService.getVariantsByProduct(req.params.id);
    res.status(200).json({ success: true, data: variants });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function createVariant(req: Request, res: Response) {
  try {
    const userId = actorId(req, res);
    if (!userId) return;
    const variant = await variantService.createVariant(req.params.id, req.body, userId);
    res.status(201).json({ success: true, data: variant });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function updateVariant(req: Request, res: Response) {
  try {
    const userId = actorId(req, res);
    if (!userId) return;
    const variant = await variantService.updateVariant(req.params.variantId, req.body, userId);
    res.status(200).json({ success: true, data: variant });
  } catch (error: any) {
    fail(res, error);
  }
}

export async function deleteVariant(req: Request, res: Response) {
  try {
    const userId = actorId(req, res);
    if (!userId) return;
    const variant = await variantService.deleteVariant(req.params.variantId, userId);
    res.status(200).json({ success: true, data: variant });
  } catch (error: any) {
    fail(res, error);
  }
}
