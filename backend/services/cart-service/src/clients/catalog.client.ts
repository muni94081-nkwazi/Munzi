import { logger } from '../utils/logger.js';

// ─── Catalogue Client ─────────────────────────────────────────────────────────
//
// How many of something a shopper may put in their basket used to be decided by
// `maxQuantity` — a number the browser sends in the request body. Sending
// `{ quantity: 5012, maxQuantity: 99999 }` stored 5,012 of a 12-stock variant,
// verified live. The bound was real, it was just the customer's own.
//
// product-service knows the real figure. Asking it here means the basket
// reflects what can actually be bought, instead of deferring every such
// disappointment to the checkout page.

const PRODUCT_SERVICE_URL = process.env.PRODUCT_SERVICE_URL ?? 'http://localhost:4002';
const TIMEOUT_MS = Number(process.env.CATALOG_TIMEOUT_MS ?? 2_000);

export interface OfferDetails {
  id:              string;
  productId:       string;
  variantId:       string;
  sellerId:        string;
  sellerSku?:      string | null;
  price:           number;
  compareAtPrice?: number | null;
  currency:        string;
  condition:       string;
  moq:             number;
  wholesaleTiers?: Array<{ minQuantity: number; unitPrice: number }> | null;
  stock:           number;
  reserved:        number;
  availableStock:  number;
  status:          string;
  product?: {
    id:         string;
    name:       string;
    status:     string;
    thumbnail?: string | null;
    images?:    string[];
  };
  variant?: {
    id:          string;
    sku:         string;
    attributes?: Record<string, unknown>;
  };
}

interface VariantResponse {
  data?: {
    stock?:          number;
    reserved?:       number;
    availableStock?: number;
  };
}

interface PublicOfferResponse {
  success?: boolean;
  data?:    OfferDetails;
}

/**
 * How many of this variant are actually sellable right now (Legacy).
 */
export async function availableStockFor(productId: string, variantId: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${PRODUCT_SERVICE_URL}/api/v1/products/${encodeURIComponent(productId)}`
        + `/variants/${encodeURIComponent(variantId)}`,
      { signal: controller.signal },
    );

    if (!response.ok) return null;

    const body = (await response.json()) as VariantResponse;
    const variant = body.data;
    if (!variant) return null;

    const available = variant.availableStock ?? (Number(variant.stock) - Number(variant.reserved));
    return Number.isFinite(available) ? Math.max(0, Number(available)) : null;
  } catch (err) {
    logger.warn('[cart] catalogue stock unavailable — not bounding this add', {
      productId, variantId, error: (err as Error).message,
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch authoritative ProductOffer details from product-service.
 */
export async function fetchOfferDetails(offerId: string): Promise<OfferDetails | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(
      `${PRODUCT_SERVICE_URL}/api/v1/public/offers/${encodeURIComponent(offerId)}`,
      { signal: controller.signal },
    );

    if (!response.ok) return null;

    const body = (await response.json()) as PublicOfferResponse;
    if (!body.data) return null;

    return {
      ...body.data,
      price:          Number(body.data.price),
      compareAtPrice: body.data.compareAtPrice ? Number(body.data.compareAtPrice) : null,
      stock:          Number(body.data.stock),
      reserved:       Number(body.data.reserved),
      availableStock: Number(body.data.availableStock ?? (Number(body.data.stock) - Number(body.data.reserved))),
      moq:            Number(body.data.moq || 1),
    };
  } catch (err) {
    logger.warn('[cart] offer details unavailable', { offerId, error: (err as Error).message });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * How many units of an offer are actually sellable right now.
 */
export async function availableStockForOffer(offerId: string): Promise<number | null> {
  const offer = await fetchOfferDetails(offerId);
  if (!offer) return null;
  return Math.max(0, offer.availableStock);
}
