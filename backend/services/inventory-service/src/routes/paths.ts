// ─── Route paths ─────────────────────────────────────────────────────────────
//
// Extracted so the two-prefix arrangement is a thing that can be asserted on,
// rather than a loop buried in index.ts that a future edit could quietly
// unpick.

/** Both prefixes the seller-facing inventory routes answer on. */
export const INVENTORY_PREFIXES = [
  '/api/v1/inventory',
  '/api/v1/seller/inventory',
] as const;

/**
 * The seller-facing route paths for variants under one prefix.
 */
export function sellerInventoryPaths(prefix: string): {
  list:      string;
  bySku:     string;
  lowStock:  string;
  byVariant: string;
} {
  return {
    list:      prefix,
    bySku:     `${prefix}/by-sku/:sku`,
    lowStock:  `${prefix}/alerts/low-stock`,
    byVariant: `${prefix}/:variantId`,
  };
}

/**
 * The seller-facing route paths for offers under one prefix.
 */
export function sellerOfferInventoryPaths(prefix: string): {
  list:           string;
  byId:           string;
  reconcile:      string;
} {
  return {
    list:           `${prefix}/offers`,
    byId:           `${prefix}/offers/:offerId`,
    reconcile:      `${prefix}/offers/:offerId/reconcile`,
  };
}

/** Paths that must stay on the bare prefix only for variants. */
export function internalInventoryPaths(prefix: string): string[] {
  return [
    `${prefix}/:variantId/reserve`,
    `${prefix}/:variantId/release`,
    `${prefix}/:variantId/deduct`,
  ];
}

/** Paths that stay on the bare prefix only for offers. */
export function internalOfferInventoryPaths(prefix: string): string[] {
  return [
    `${prefix}/offers/:offerId/reserve`,
    `${prefix}/offers/:offerId/release`,
    `${prefix}/offers/:offerId/deduct`,
    `${prefix}/offers/:offerId/restore`,
  ];
}
