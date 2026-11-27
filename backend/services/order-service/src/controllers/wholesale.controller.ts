import { logger } from '../utils/logger.js';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { wholesaleService } from '../services/wholesale.service.js';

// ─── Wholesale Controller ─────────────────────────────────────────────────────
//
// Hardened B2B wholesale controller supporting dynamic offer tiers, MOQ,
// MongoDB persistence, Trade Assurance protection, and escrow settlement.

const TiersQuerySchema = z.object({
  productId: z.string().min(1, 'productId is required'),
  offerId:   z.string().optional(),
});

const CreateOrderSchema = z.object({
  productId:      z.string().min(1, 'productId is required'),
  quantity:       z.number().int().min(1, 'quantity must be at least 1').max(100_000),
  offerId:        z.string().optional(),
  paymentTerms:   z.enum(['FULL_UPFRONT', 'NET_30', 'NET_60', 'DEPOSIT_MILESTONE']).optional(),
  tradeAssurance: z.boolean().optional(),
  shippingAddress: z
    .object({
      address:     z.string().min(1),
      city:        z.string().min(1),
      country:     z.string().optional(),
      phone:       z.string().min(1),
      contactName: z.string().optional(),
    })
    .optional(),
});

const UpdateStatusSchema = z.object({
  status:             z.enum(['PENDING', 'APPROVED', 'PAID', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
  cancellationReason: z.string().optional(),
});

const DisputeSchema = z.object({
  reason: z.string().min(1, 'Dispute reason is required'),
});

function fail(res: Response, err: unknown): void {
  const error  = err as Error & { status?: number };
  const status = error.status ?? 500;

  if (status >= 500) {
    logger.error('wholesale request failed', { detail: error.message });
  }

  res.status(status).json({
    success: false,
    message: status >= 500 ? 'Could not complete that request. Please try again.' : error.message,
    code:    error.name,
  });
}

function isAdmin(res: Response): boolean {
  const roles = (res.locals.roles as string[]) ?? [];
  return roles.includes('ROLE_ADMIN') || roles.includes('ROLE_SUPER_ADMIN');
}

/** GET /api/v1/wholesale/tiers?productId=…&offerId=… */
export async function getTiers(req: Request, res: Response): Promise<void> {
  const parsed = TiersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid request',
      errors:  parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const tiers = await wholesaleService.getWholesaleTiers(
      parsed.data.productId,
      parsed.data.offerId,
      res.locals.userId as string | undefined,
    );
    res.json({ success: true, data: tiers });
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/v1/wholesale/orders */
export async function createOrder(req: Request, res: Response): Promise<void> {
  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid request',
      errors:  parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const order = await wholesaleService.createWholesaleOrder(
      res.locals.userId as string,
      parsed.data.productId,
      parsed.data.quantity,
      {
        offerId:        parsed.data.offerId,
        paymentTerms:   parsed.data.paymentTerms,
        tradeAssurance: parsed.data.tradeAssurance,
        shippingAddress: parsed.data.shippingAddress,
      },
    );
    res.status(201).json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/v1/wholesale/orders */
export async function listOrders(_req: Request, res: Response): Promise<void> {
  try {
    const orders = await wholesaleService.listWholesaleOrders(res.locals.userId as string);
    res.json({ success: true, data: orders });
  } catch (err) {
    fail(res, err);
  }
}

/** GET /api/v1/wholesale/orders/:id */
export async function getOrderById(req: Request, res: Response): Promise<void> {
  try {
    const order = await wholesaleService.getWholesaleOrder(
      req.params.id,
      res.locals.userId as string,
      isAdmin(res),
    );
    res.json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}

/** PATCH /api/v1/wholesale/orders/:id/status */
export async function updateStatus(req: Request, res: Response): Promise<void> {
  const parsed = UpdateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid request',
      errors:  parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const isInternal = Boolean(res.locals.callingService);
    const admin = isAdmin(res);
    const order = await wholesaleService.updateOrderStatus(
      req.params.id,
      parsed.data.status,
      res.locals.userId as string,
      parsed.data.cancellationReason,
      { isInternal, isAdmin: admin },
    );
    res.json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/v1/wholesale/orders/:id/confirm-payment */
export async function confirmPayment(req: Request, res: Response): Promise<void> {
  const isInternal = Boolean(res.locals.callingService);
  const admin = isAdmin(res);

  if (!isInternal && !admin) {
    res.status(403).json({
      success: false,
      message: 'Payment confirmation is restricted to internal payment services or authorized administrators.',
      code: 'UnauthorizedWholesaleActionError',
    });
    return;
  }

  try {
    const order = await wholesaleService.confirmTradeAssurancePayment(
      req.params.id,
      req.body?.paymentReference,
      { isInternal, isAdmin: admin },
    );
    res.json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/v1/wholesale/orders/:id/release-escrow */
export async function releaseEscrow(req: Request, res: Response): Promise<void> {
  const isInternal = Boolean(res.locals.callingService);
  const admin = isAdmin(res);

  try {
    const order = await wholesaleService.releaseTradeAssuranceEscrow(
      req.params.id,
      res.locals.userId as string,
      { isInternal, isAdmin: admin },
    );
    res.json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}

/** POST /api/v1/wholesale/orders/:id/dispute */
export async function disputeOrder(req: Request, res: Response): Promise<void> {
  const parsed = DisputeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: 'Invalid request',
      errors:  parsed.error.flatten().fieldErrors,
    });
    return;
  }

  try {
    const isInternal = Boolean(res.locals.callingService);
    const admin = isAdmin(res);
    const order = await wholesaleService.disputeTradeAssurance(
      req.params.id,
      res.locals.userId as string,
      parsed.data.reason,
      { isInternal, isAdmin: admin },
    );
    res.json({ success: true, data: order });
  } catch (err) {
    fail(res, err);
  }
}
