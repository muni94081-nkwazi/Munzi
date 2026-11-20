// MUST be first: starts OpenTelemetry before any instrumented library loads.
import { logger } from './utils/logger.js';
import './telemetry.js';
import 'dotenv/config';
import express, { type RequestHandler } from 'express';
import { internalCors } from '../../../shared/http/internal-cors.js';
import { z } from 'zod';
import {
  INVENTORY_PREFIXES,
  sellerInventoryPaths,
  sellerOfferInventoryPaths,
} from './routes/paths.js';
import { PrismaClient } from './generated/prisma/index.js';
import {
  reserveInventory,
  reserveOfferInventory,
  releaseInventory,
  deductInventory,
  restoreInventory,
  reconcileInventory,
  restoreProductAvailability,
  settleOfferDerivedState,
  settleVariantDerivedState,
  InsufficientStockError,
  ExpiredReservationStockUnavailableError,
} from './services/reservation.service.js';
import { bumpEntityVersion } from '../../../shared/cache/protected-cache.js';
import { connectCache } from '../../../shared/cache/redis.js';
import { startRabbitMQOrderConsumer, stopRabbitMQOrderConsumer } from './consumers/order-rabbitmq.consumer.js';
import { connectRabbitMQ, disconnectRabbitMQ } from '../../../shared/rabbitmq/index.js';
import { startExpiryWorker, stopExpiryWorker } from './jobs/expiry.worker.js';
import {
  requireAuth,
  requireInternalCaller,
  assertInternalIdentityConfigured,
} from '../../../shared/http/service-auth.middleware.js';
import {
  maySee,
  maySeeOffer,
  ownCatalogueFilter,
  ownOfferFilter,
  isAdmin,
} from './auth/scope.js';

// Stock lives on product-service's tables, on the same database — this service
// reads and writes them through its own generated client. `npm run db:generate`
// emits it from prisma/schema.prisma, which is a non-authoritative mirror of
// product-service's models; see the header there before editing.
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const app  = express();
const PORT = Number(process.env.PORT ?? 4004);

app.use(internalCors());
app.use(express.json());

const RESERVATION_TTL_MINUTES = Number(process.env.RESERVATION_TTL_MINUTES ?? 15);
const LOW_STOCK_THRESHOLD     = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);

// ─── Request validation ───────────────────────────────────────────────────────

const ReserveSchema = z.object({
  quantity:  z.number().int().min(1).max(10_000),
  sessionId: z.string().trim().min(1, 'sessionId is required').max(128),
  userId:    z.string().trim().max(128).optional(),
  offerId:   z.string().trim().min(1).optional(),
});

const ReleaseSchema = z.object({
  reservationId: z.string().trim().min(1).optional(),
  quantity:      z.number().int().min(1).max(10_000).optional(),
  offerId:       z.string().trim().min(1).optional(),
}).refine(
  (data) => data.reservationId !== undefined || data.quantity !== undefined,
  { message: 'Provide either a reservationId or a quantity to release' },
);

const DeductSchema = z.object({
  quantity:      z.number().int().min(1).max(10_000),
  reservationId: z.string().trim().min(1).optional(),
  offerId:       z.string().trim().min(1).optional(),
});

const RestoreSchema = z.object({
  quantity: z.number().int().min(1).max(10_000),
  /** Recorded on the log line so a restore can be traced to what caused it. */
  reason:   z.string().trim().max(200).optional(),
  offerId:  z.string().trim().min(1).optional(),
});

const RestockSchema = z.object({
  stock:             z.number().int().min(0).max(10_000_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
}).refine(
  (data) => data.stock !== undefined || data.lowStockThreshold !== undefined,
  { message: 'Provide stock or lowStockThreshold to update' },
);

function invalid(res: express.Response, error: z.ZodError) {
  return res.status(400).json({
    success: false,
    message: 'Invalid request',
    errors:  error.flatten().fieldErrors,
  });
}

function notFound(res: express.Response, what: string) {
  return res.status(404).json({ success: false, message: `${what} not found` });
}

function handleError(res: express.Response, err: unknown) {
  if (err instanceof ExpiredReservationStockUnavailableError) {
    return res.status(err.status).json({
      success: false,
      code:    err.code,
      message: err.message,
    });
  }
  if (err instanceof InsufficientStockError) {
    return res.status(err.status).json({
      success:   false,
      message:   err.message,
      available: err.available,
    });
  }
  const e = err as Error & { status?: number; code?: string };
  return res.status(e.status ?? 500).json({
    success: false,
    message: e.message || 'Internal server error',
    ...(e.code && { code: e.code }),
  });
}

// ── Health ─────────────────────────────────────────────────────────────────────

app.get('/health',       async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok', service: 'inventory-service', db: 'connected' }); });
app.get('/health/live',  (_req, res) => res.json({ status: 'ok' }));
app.get('/health/ready', async (_req, res) => { try { await prisma.$queryRaw`SELECT 1`; res.json({ status: 'ok' }); } catch { res.status(503).json({ status: 'error', db: 'disconnected' }); } });

// ── Seller-facing read/write handlers: Variants (Legacy) ───────────────────────

const listInventory: RequestHandler = async (_req, res) => {
  const variants = await prisma.productVariant.findMany({
    where:   { active: true, ...ownCatalogueFilter(res) },
    include: { product: { select: { id: true, name: true, sellerId: true } } },
    orderBy: { stock: 'asc' },
  });

  const lowStock = variants.filter((v) => v.stock - v.reserved <= LOW_STOCK_THRESHOLD);

  res.json({
    success: true,
    data:    variants.map(formatVariant),
    meta:    { total: variants.length, lowStock: lowStock.length },
  });
};

const getVariant: RequestHandler = async (req, res) => {
  const variant = await prisma.productVariant.findUnique({
    where:   { id: req.params.variantId },
    include: { product: { select: { id: true, name: true, sellerId: true } } },
  }).catch(() => null);

  if (!maySee(res, variant)) return notFound(res, 'Variant');
  return res.json({ success: true, data: formatVariant(variant!) });
};

const getBySku: RequestHandler = async (req, res) => {
  const variant = await prisma.productVariant.findUnique({
    where:   { sku: req.params.sku },
    include: { product: { select: { id: true, name: true, sellerId: true } } },
  }).catch(() => null);

  if (!maySee(res, variant)) return notFound(res, 'SKU');
  return res.json({ success: true, data: formatVariant(variant!) });
};

const restock: RequestHandler = async (req, res) => {
  const parsed = RestockSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { stock, lowStockThreshold } = parsed.data;

  const existing = await prisma.productVariant.findUnique({
    where:   { id: req.params.variantId },
    include: { product: { select: { sellerId: true } } },
  }).catch(() => null);

  if (!maySee(res, existing)) return notFound(res, 'Variant');

  const updated = await prisma.productVariant.update({
    where: { id: req.params.variantId },
    data: {
      ...(stock              !== undefined && { stock }),
      ...(lowStockThreshold  !== undefined && { lowStockThreshold }),
    },
  });

  await restoreVariantProduct(req.params.variantId);

  return res.json({ success: true, data: formatVariant(updated) });
};

const lowStockAlerts: RequestHandler = async (_req, res) => {
  const variants = await prisma.productVariant.findMany({
    where: {
      active: true,
      stock: { lte: LOW_STOCK_THRESHOLD },
      ...ownCatalogueFilter(res),
    },
    include: { product: { select: { id: true, name: true, sellerId: true } } },
  });

  return res.json({ success: true, data: variants.map(formatVariant), meta: { count: variants.length } });
};

const reconcileVariantHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.productVariant.findUnique({
    where:   { id: req.params.variantId },
    include: { product: { select: { sellerId: true } } },
  }).catch(() => null);

  if (!maySee(res, existing)) return notFound(res, 'Variant');

  const autoCorrect = req.query.autoCorrect === 'true' && isAdmin(res);
  try {
    const report = await reconcileInventory(prisma, {
      variantId:   req.params.variantId,
      autoCorrect,
      reason:      req.body?.reason ?? 'Manual variant reconciliation request',
    });
    return res.json({ success: true, data: report });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Seller-facing read/write handlers: ProductOffer (Multi-Vendor) ─────────────

const listOfferInventory: RequestHandler = async (_req, res) => {
  const offers = await prisma.productOffer.findMany({
    where:   { ...ownOfferFilter(res) },
    include: {
      product: { select: { id: true, name: true, sellerId: true } },
      variant: { select: { id: true, sku: true } },
    },
    orderBy: { stock: 'asc' },
  });

  const lowStock = offers.filter((o) => o.stock - o.reserved <= LOW_STOCK_THRESHOLD);

  return res.json({
    success: true,
    data:    offers.map(formatOffer),
    meta:    { total: offers.length, lowStock: lowStock.length },
  });
};

const getOfferInventory: RequestHandler = async (req, res) => {
  const offer = await prisma.productOffer.findUnique({
    where:   { id: req.params.offerId },
    include: {
      product: { select: { id: true, name: true, sellerId: true } },
      variant: { select: { id: true, sku: true } },
    },
  }).catch(() => null);

  if (!maySeeOffer(res, offer)) return notFound(res, 'Offer');
  return res.json({ success: true, data: formatOffer(offer!) });
};

const restockOfferInventory: RequestHandler = async (req, res) => {
  const parsed = RestockSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { stock, lowStockThreshold } = parsed.data;

  const existing = await prisma.productOffer.findUnique({
    where:  { id: req.params.offerId },
    select: { id: true, sellerId: true, stock: true, reserved: true, status: true },
  }).catch(() => null);

  if (!maySeeOffer(res, existing)) return notFound(res, 'Offer');

  const updated = await prisma.productOffer.update({
    where: { id: req.params.offerId },
    data: {
      ...(stock              !== undefined && { stock }),
      ...(lowStockThreshold  !== undefined && { lowStockThreshold }),
    },
    include: {
      product: { select: { id: true, name: true, sellerId: true } },
      variant: { select: { id: true, sku: true } },
    },
  });

  await settleOfferDerivedState(prisma, req.params.offerId);

  return res.json({ success: true, data: formatOffer(updated) });
};

const reconcileOfferHandler: RequestHandler = async (req, res) => {
  const existing = await prisma.productOffer.findUnique({
    where:  { id: req.params.offerId },
    select: { id: true, sellerId: true },
  }).catch(() => null);

  if (!maySeeOffer(res, existing)) return notFound(res, 'Offer');

  const autoCorrect = req.query.autoCorrect === 'true' && isAdmin(res);
  try {
    const report = await reconcileInventory(prisma, {
      offerId:     req.params.offerId,
      autoCorrect,
      reason:      req.body?.reason ?? 'Manual offer reconciliation request',
    });
    return res.json({ success: true, data: report });
  } catch (err) {
    return handleError(res, err);
  }
};

// ── Service-to-Service: Variant-based Operations (Legacy) ──────────────────────

app.post('/api/v1/inventory/:variantId/reserve', requireInternalCaller, async (req, res) => {
  const parsed = ReserveSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, sessionId, userId, offerId } = parsed.data;

  try {
    let reservation;
    if (offerId) {
      // Polymorphic delegation if offerId is supplied
      reservation = await reserveOfferInventory(prisma, {
        offerId,
        quantity,
        sessionId,
        userId,
        ttlMinutes: RESERVATION_TTL_MINUTES,
      });
    } else {
      reservation = await reserveInventory(prisma, {
        variantId:  req.params.variantId,
        quantity,
        sessionId,
        userId,
        ttlMinutes: RESERVATION_TTL_MINUTES,
      });
    }

    return res.status(201).json({
      success:       true,
      data:          { reservationId: reservation.id, expiresAt: reservation.expiresAt },
      message:       `Reserved ${quantity} unit(s) for ${RESERVATION_TTL_MINUTES} minutes`,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/:variantId/release', requireInternalCaller, async (req, res) => {
  const parsed = ReleaseSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { reservationId, quantity, offerId } = parsed.data;

  try {
    const result = await releaseInventory(prisma, {
      reservationId,
      variantId: req.params.variantId,
      offerId,
      quantity,
    });

    return res.json({ success: true, message: 'Reservation released', data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/:variantId/deduct', requireInternalCaller, async (req, res) => {
  const parsed = DeductSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, reservationId, offerId } = parsed.data;

  try {
    const result = await deductInventory(prisma, {
      reservationId,
      variantId: req.params.variantId,
      offerId,
      quantity,
    });

    return res.json({ success: true, message: `Deducted ${quantity} unit(s)`, data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/:variantId/restore', requireInternalCaller, async (req, res) => {
  const parsed = RestoreSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, reason, offerId } = parsed.data;

  try {
    const result = await restoreInventory(prisma, {
      variantId: req.params.variantId,
      offerId,
      quantity,
      reason,
    });

    logger.info('variant stock restored', { detail: { variantId: req.params.variantId, quantity, reason } });

    return res.json({ success: true, message: `Restored ${quantity} unit(s)`, data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Service-to-Service: Dedicated Offer-based Operations ───────────────────────

app.post('/api/v1/inventory/offers/:offerId/reserve', requireInternalCaller, async (req, res) => {
  const parsed = ReserveSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, sessionId, userId } = parsed.data;

  try {
    const reservation = await reserveOfferInventory(prisma, {
      offerId:    req.params.offerId,
      quantity,
      sessionId,
      userId,
      ttlMinutes: RESERVATION_TTL_MINUTES,
    });

    return res.status(201).json({
      success:       true,
      data:          { reservationId: reservation.id, expiresAt: reservation.expiresAt, offerId: reservation.offerId },
      message:       `Reserved ${quantity} unit(s) for ${RESERVATION_TTL_MINUTES} minutes on offer ${req.params.offerId}`,
    });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/offers/:offerId/release', requireInternalCaller, async (req, res) => {
  const parsed = ReleaseSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { reservationId, quantity } = parsed.data;

  try {
    const result = await releaseInventory(prisma, {
      reservationId,
      offerId:  req.params.offerId,
      quantity,
    });

    return res.json({ success: true, message: 'Offer reservation released', data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/offers/:offerId/deduct', requireInternalCaller, async (req, res) => {
  const parsed = DeductSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, reservationId } = parsed.data;

  try {
    const result = await deductInventory(prisma, {
      reservationId,
      offerId:  req.params.offerId,
      quantity,
    });

    return res.json({ success: true, message: `Deducted ${quantity} unit(s) from offer ${req.params.offerId}`, data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

app.post('/api/v1/inventory/offers/:offerId/restore', requireInternalCaller, async (req, res) => {
  const parsed = RestoreSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error);

  const { quantity, reason } = parsed.data;

  try {
    const result = await restoreInventory(prisma, {
      offerId:  req.params.offerId,
      quantity,
      reason,
    });

    logger.info('offer stock restored', { detail: { offerId: req.params.offerId, quantity, reason } });

    return res.json({ success: true, message: `Restored ${quantity} unit(s) to offer ${req.params.offerId}`, data: result });
  } catch (err) {
    return handleError(res, err);
  }
});

// ── Route Registrations under Both Prefixes ───────────────────────────────────

for (const prefix of INVENTORY_PREFIXES) {
  // Variant routes
  const vPath = sellerInventoryPaths(prefix);
  app.get(vPath.list,                    requireAuth, listInventory);
  app.get(vPath.bySku,                   requireAuth, getBySku);
  app.get(vPath.lowStock,                requireAuth, lowStockAlerts);
  app.get(vPath.byVariant,               requireAuth, getVariant);
  app.put(vPath.byVariant,               requireAuth, restock);
  app.get(`${prefix}/:variantId/reconcile`, requireAuth, reconcileVariantHandler);

  // Offer routes
  const oPath = sellerOfferInventoryPaths(prefix);
  app.get(oPath.list,      requireAuth, listOfferInventory);
  app.get(oPath.byId,      requireAuth, getOfferInventory);
  app.put(oPath.byId,      requireAuth, restockOfferInventory);
  app.get(oPath.reconcile, requireAuth, reconcileOfferHandler);
}

// ── Helper Formatter ──────────────────────────────────────────────────────────

async function settleDerivedState(variantId: string): Promise<void> {
  await settleVariantDerivedState(prisma, variantId);
}

const restoreVariantProduct = settleDerivedState;

function formatVariant(v: { id: string; sku: string; productId: string; stock: number; reserved: number; lowStockThreshold: number; [key: string]: unknown }) {
  return {
    ...v,
    availableStock: v.stock - v.reserved,
    inStock:        v.stock - v.reserved > 0,
    isLowStock:     v.stock - v.reserved <= v.lowStockThreshold,
  };
}

function formatOffer(o: { id: string; variantId: string; productId: string; sellerId: string; stock: number; reserved: number; lowStockThreshold: number; status: string; [key: string]: unknown }) {
  return {
    ...o,
    availableStock: o.stock - o.reserved,
    inStock:        o.stock - o.reserved > 0,
    isLowStock:     o.stock - o.reserved <= o.lowStockThreshold,
  };
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function start() {
  await connectCache('inventory-service').catch(() => {});

  await prisma.$connect();
  logger.info('✅ Database connected');

  try {
    await connectRabbitMQ();
    await startRabbitMQOrderConsumer();
  } catch (err) {
    logger.warn('RabbitMQ consumer failed to start (non-fatal)', { detail: (err as Error).message });
  }

  startExpiryWorker()
    .then(() => logger.info('✅ Expiry worker started (sweep every 5m)'))
    .catch((err) => logger.warn('Expiry worker failed to start (non-fatal)', { detail: (err as Error).message }));

  assertInternalIdentityConfigured('inventory-service');

  const server = app.listen(PORT, () =>
    logger.info(`🚀 Listening on port ${PORT}`)
  );

  async function shutdown(signal: string) {
    logger.info(`${signal} — shutting down`);
    await Promise.allSettled([stopRabbitMQOrderConsumer(), disconnectRabbitMQ(), stopExpiryWorker()]);
    await prisma.$disconnect();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error('Fatal startup error', { detail: err });
  process.exit(1);
});

export default app;
