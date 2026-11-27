import { randomUUID } from 'node:crypto';
import { fetchProduct, fetchOffer } from '../clients/catalog.client.js';
import { wholesaleRepository, type IWholesaleRepository } from '../repositories/wholesale.repository.js';

// ─── Wholesale & B2B Trade Settlement ──────────────────────────────────────────
//
// Hardened B2B wholesale orders with dynamic volume tier pricing, minimum order
// quantity (MOQ) enforcement, MongoDB database persistence, Trade Assurance,
// and escrow lifecycle tracking.
//
// ARCHITECTURAL NOTE ON TRADE ASSURANCE:
// Trade Assurance in order-service functions as an order-tracking and status-
// coordination state machine. It records and transitions escrow milestone
// states ('pending', 'held', 'released', 'refunded', 'disputed'), but does NOT
// perform real financial escrow or debit/credit ledger operations. Actual monetary
// settlement is deferred to payment-service integration.

export interface BulkDiscountTier {
  minQty: number;
  maxQty?: number;
  discountPercent: number;
  unitPrice: number;
}

export interface WholesaleShippingAddress {
  address: string;
  city: string;
  country?: string;
  phone: string;
  contactName?: string;
}

export interface WholesaleOrder {
  id: string;
  orderNumber?: string;
  userId: string;
  sellerId?: string;
  productId: string;
  offerId?: string | null;
  variantId?: string | null;
  productName?: string;
  quantity: number;
  moq?: number;
  unitPrice: number;
  basePrice?: number;
  discountPercentage: number;
  totalPrice: number;
  currency?: string;
  status: 'PENDING' | 'APPROVED' | 'PAID' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  paymentTerms?: 'FULL_UPFRONT' | 'NET_30' | 'NET_60' | 'DEPOSIT_MILESTONE';
  tradeAssurance?: boolean;
  escrowStatus?: 'pending' | 'held' | 'released' | 'refunded' | 'disputed';
  depositAmount?: number;
  shippingAddress?: WholesaleShippingAddress | null;
  placedAt?: string | null;
  paidAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateWholesaleOrderOptions {
  offerId?: string;
  paymentTerms?: 'FULL_UPFRONT' | 'NET_30' | 'NET_60' | 'DEPOSIT_MILESTONE';
  tradeAssurance?: boolean;
  shippingAddress?: WholesaleShippingAddress;
}

/** Tier structure. Percentages only — the money comes from the catalogue. */
const TIER_BANDS: Array<{ minQty: number; maxQty?: number; discountPercent: number }> = [
  { minQty: 1,   maxQty: 9,  discountPercent: 0  },
  { minQty: 10,  maxQty: 49, discountPercent: 10 },
  { minQty: 50,  maxQty: 99, discountPercent: 18 },
  { minQty: 100,             discountPercent: 25 },
];

export interface AuthContext {
  isInternal?: boolean;
  isAdmin?: boolean;
}

export class InvalidWholesaleRequestError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWholesaleRequestError';
  }
}

export class WholesaleNotFoundError extends Error {
  readonly status = 404;
  constructor(id: string) {
    super(`Wholesale order "${id}" was not found.`);
    this.name = 'WholesaleNotFoundError';
  }
}

export class UnauthorizedWholesaleActionError extends Error {
  readonly status = 403;
  constructor(message = 'You do not have permission to modify this wholesale order.') {
    super(message);
    this.name = 'UnauthorizedWholesaleActionError';
  }
}

function buildTiers(basePrice: number): BulkDiscountTier[] {
  return TIER_BANDS.map((band) => ({
    ...band,
    unitPrice: Math.round(basePrice * (1 - band.discountPercent / 100)),
  }));
}

export class WholesaleService {
  constructor(private readonly repo: IWholesaleRepository = wholesaleRepository) {}

  /**
   * Tiers for a product or specific offer, priced from the catalogue.
   * If an offer has custom wholesale tiers, returns those dynamic volume tiers.
   */
  async getWholesaleTiers(
    productId: string,
    offerId?: string,
    actorId?: string,
  ): Promise<BulkDiscountTier[]> {
    if (offerId) {
      try {
        const offer = await fetchOffer(offerId, 1, actorId);
        if (offer.wholesaleTiers && offer.wholesaleTiers.length > 0) {
          const sorted = [...offer.wholesaleTiers].sort((a, b) => a.minQuantity - b.minQuantity);
          const basePrice = offer.price;
          return sorted.map((t, idx, arr) => {
            const next = arr[idx + 1];
            const discountPercent =
              basePrice > 0 ? Math.max(0, Math.round(((basePrice - t.unitPrice) / basePrice) * 100)) : 0;
            return {
              minQty: t.minQuantity,
              maxQty: next ? next.minQuantity - 1 : undefined,
              discountPercent,
              unitPrice: t.unitPrice,
            };
          });
        }
        return buildTiers(offer.price);
      } catch {
        // Fallback to catalogue product if offer lookup is unresolvable
      }
    }

    const product = await fetchProduct(productId, actorId);
    return buildTiers(product.basePrice);
  }

  /**
   * Create a wholesale bulk order with MOQ enforcement, dynamic volume pricing,
   * Trade Assurance, and persistent storage.
   */
  async createWholesaleOrder(
    userId: string,
    productId: string,
    quantity: number,
    options?: CreateWholesaleOrderOptions,
  ): Promise<WholesaleOrder> {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new InvalidWholesaleRequestError('Quantity must be a whole number of at least 1.');
    }

    let unitPrice: number;
    let basePrice: number;
    let discountPercentage: number;
    let sellerId: string;
    let productName: string;
    let variantId: string | null = null;
    let currency = 'UGX';
    let moq = 1;

    if (options?.offerId) {
      const offer = await fetchOffer(options.offerId, quantity, userId);

      moq = Number(offer.moq || 1);
      if (quantity < moq) {
        throw new InvalidWholesaleRequestError(
          `Quantity ${quantity} is below the minimum order quantity (MOQ) of ${moq}.`,
        );
      }

      unitPrice = offer.price;
      basePrice = offer.wholesaleTiers?.[0]?.unitPrice ?? offer.price;
      discountPercentage =
        basePrice > unitPrice ? Math.round(((basePrice - unitPrice) / basePrice) * 100) : 0;
      sellerId = offer.sellerId;
      productName = offer.productName ?? 'Product';
      variantId = offer.variantId ?? null;
      currency = offer.currency ?? 'UGX';
    } else {
      const product = await fetchProduct(productId, userId);
      const tiers = buildTiers(product.basePrice);
      const applicableTier = [...tiers].reverse().find((t) => quantity >= t.minQty) ?? tiers[0];

      unitPrice = applicableTier.unitPrice;
      basePrice = product.basePrice;
      discountPercentage = applicableTier.discountPercent;
      sellerId = product.sellerId;
      productName = product.name;
      currency = product.currency ?? 'UGX';
    }

    const totalPrice = unitPrice * quantity;
    const paymentTerms = options?.paymentTerms ?? 'FULL_UPFRONT';
    const depositAmount =
      paymentTerms === 'DEPOSIT_MILESTONE' ? Math.round(totalPrice * 0.3) : totalPrice;

    const idSuffix = randomUUID().slice(0, 8).toUpperCase();
    const now = new Date().toISOString();

    const order: WholesaleOrder = {
      id: `WS-${idSuffix}`,
      orderNumber: `MUNI-WS-${idSuffix}`,
      userId,
      sellerId,
      productId,
      offerId: options?.offerId ?? null,
      variantId,
      productName,
      quantity,
      moq,
      unitPrice,
      basePrice,
      discountPercentage,
      totalPrice,
      currency,
      status: 'APPROVED',
      paymentTerms,
      tradeAssurance: options?.tradeAssurance !== false,
      escrowStatus: 'pending',
      depositAmount,
      shippingAddress: options?.shippingAddress ?? null,
      placedAt: now,
      createdAt: now,
      updatedAt: now,
    };

    return this.repo.create(order);
  }

  /**
   * Retrieve a buyer's wholesale orders from persistent storage.
   */
  async listWholesaleOrders(userId: string): Promise<WholesaleOrder[]> {
    return this.repo.listByUserId(userId);
  }

  /**
   * Retrieve a seller's wholesale orders.
   */
  async listSellerWholesaleOrders(sellerId: string): Promise<WholesaleOrder[]> {
    return this.repo.listBySellerId(sellerId);
  }

  /**
   * Get wholesale order by ID with buyer/seller/admin access check.
   */
  async getWholesaleOrder(
    id: string,
    actorId: string,
    isAdmin = false,
  ): Promise<WholesaleOrder> {
    const order = await this.repo.findById(id);
    if (!order) throw new WholesaleNotFoundError(id);

    const isBuyer = order.userId === actorId;
    const isSeller = order.sellerId === actorId;
    if (!isBuyer && !isSeller && !isAdmin) {
      throw new UnauthorizedWholesaleActionError();
    }

    return order;
  }

  /**
   * Update order status across B2B lifecycle (DISPATCHED, DELIVERED, CANCELLED).
   * STRICT ROLE-BASED TRANSITIONS & ATOMIC PERSISTENCE:
   * - PAID cannot be set via updateOrderStatus (must go through confirmTradeAssurancePayment).
   * - DISPATCHED: Only seller or admin can mark dispatched; order must be APPROVED or PAID.
   * - DELIVERED: Only buyer or admin can mark delivered; order must be DISPATCHED.
   * - CANCELLED:
   *     - Buyer can cancel only while PENDING or APPROVED (cannot cancel once dispatched).
   *     - Seller can cancel while PENDING or APPROVED, and must provide a cancellation reason.
   *     - Admin can cancel prior to terminal states (PENDING, APPROVED, PAID, DISPATCHED).
   * - Terminal states (DELIVERED, CANCELLED) cannot transition to any other status.
   */
  async updateOrderStatus(
    id: string,
    status: WholesaleOrder['status'],
    actorId: string,
    cancellationReason?: string,
    caller?: AuthContext | boolean,
  ): Promise<WholesaleOrder> {
    const isInternal = typeof caller === 'object' ? Boolean(caller?.isInternal) : false;
    const isAdmin = typeof caller === 'object' ? Boolean(caller?.isAdmin) : Boolean(caller);

    const order = await this.getWholesaleOrder(id, actorId, isAdmin);

    if (status === 'PAID') {
      throw new InvalidWholesaleRequestError(
        'Cannot transition to PAID directly; use authorized payment confirmation.',
      );
    }

    if (order.status === 'DELIVERED' || order.status === 'CANCELLED') {
      throw new InvalidWholesaleRequestError(
        `Cannot change status of an already ${order.status.toLowerCase()} wholesale order.`,
      );
    }

    const isBuyer = order.userId === actorId;
    const isSeller = order.sellerId === actorId;

    let allowedFromStatuses: WholesaleOrder['status'][];

    switch (status) {
      case 'APPROVED': {
        if (!isSeller && !isAdmin && !isInternal) {
          throw new UnauthorizedWholesaleActionError('Only the seller or an administrator can approve this order.');
        }
        allowedFromStatuses = ['PENDING'];
        break;
      }

      case 'DISPATCHED': {
        if (!isSeller && !isAdmin && !isInternal) {
          throw new UnauthorizedWholesaleActionError('Only the seller or an administrator can dispatch this order.');
        }
        if (order.status === 'PENDING') {
          throw new InvalidWholesaleRequestError('Cannot dispatch an order that has not been approved.');
        }
        allowedFromStatuses = ['APPROVED', 'PAID'];
        break;
      }

      case 'DELIVERED': {
        if (!isBuyer && !isAdmin && !isInternal) {
          throw new UnauthorizedWholesaleActionError('Only the buyer or an administrator can confirm delivery.');
        }
        if (order.status !== 'DISPATCHED') {
          throw new InvalidWholesaleRequestError(
            `Cannot mark order delivered when status is "${order.status}". Order must be DISPATCHED first.`,
          );
        }
        allowedFromStatuses = ['DISPATCHED'];
        break;
      }

      case 'CANCELLED': {
        if (order.status === 'DISPATCHED' && !isAdmin && !isInternal) {
          throw new InvalidWholesaleRequestError(
            'Cannot cancel an order that has already been dispatched. Raise a dispute instead.',
          );
        }
        if (isSeller && !isAdmin && !isInternal) {
          if (!cancellationReason || !cancellationReason.trim()) {
            throw new InvalidWholesaleRequestError('A cancellation reason is required for seller cancellations.');
          }
        }
        if (!isBuyer && !isSeller && !isAdmin && !isInternal) {
          throw new UnauthorizedWholesaleActionError('You do not have permission to cancel this order.');
        }
        allowedFromStatuses = isAdmin || isInternal
          ? ['PENDING', 'APPROVED', 'PAID', 'DISPATCHED']
          : ['PENDING', 'APPROVED'];
        break;
      }

      default:
        throw new InvalidWholesaleRequestError(`Invalid target order status: "${status}".`);
    }

    const now = new Date().toISOString();
    const extraFields: Partial<WholesaleOrder> = {
      ...(cancellationReason ? { cancellationReason } : {}),
    };
    if (status === 'DISPATCHED' && !order.shippedAt) extraFields.shippedAt = now;
    if (status === 'DELIVERED' && !order.deliveredAt) extraFields.deliveredAt = now;
    if (status === 'CANCELLED' && !order.cancelledAt) extraFields.cancelledAt = now;

    const updated = await this.repo.updateStatusAtomic(id, allowedFromStatuses, status, extraFields);

    if (!updated) {
      throw new InvalidWholesaleRequestError(
        `Failed to transition order status to "${status}": order status was concurrently modified or is not in [${allowedFromStatuses.join(', ')}].`,
      );
    }

    return updated;
  }

  /**
   * Confirm Trade Assurance deposit/payment; marks order PAID and escrow 'held'.
   * STRICT SECURITY: Only authorized internal callers (e.g. payment-service callback)
   * or administrators can confirm payment. Client calls are rejected.
   */
  async confirmTradeAssurancePayment(
    id: string,
    _paymentReference?: string,
    caller?: AuthContext | boolean,
  ): Promise<WholesaleOrder> {
    const isInternal = typeof caller === 'object' ? Boolean(caller?.isInternal) : false;
    const isAdmin = typeof caller === 'object' ? Boolean(caller?.isAdmin) : Boolean(caller);

    if (!isInternal && !isAdmin) {
      throw new UnauthorizedWholesaleActionError(
        'Payment confirmation is restricted to internal payment services or authorized administrators.',
      );
    }

    const order = await this.repo.findById(id);
    if (!order) throw new WholesaleNotFoundError(id);

    // Atomic conditional update: can only transition from PENDING or APPROVED to PAID
    const updated = await this.repo.updateStatusAtomic(
      id,
      ['PENDING', 'APPROVED'],
      'PAID',
      {
        escrowStatus: 'held',
        paidAt: new Date().toISOString(),
      },
    );

    if (!updated) {
      throw new InvalidWholesaleRequestError(
        `Cannot confirm payment: order "${id}" is in "${order.status}" status or payment was already confirmed.`,
      );
    }

    return updated;
  }

  /**
   * Release Trade Assurance escrow to seller upon delivery acceptance.
   * STRICT SECURITY: Sellers are NEVER permitted to release escrow to themselves.
   * Can only be released by the buyer, an administrator, or internal settlement.
   */
  async releaseTradeAssuranceEscrow(
    id: string,
    actorId: string,
    caller?: AuthContext | boolean,
  ): Promise<WholesaleOrder> {
    const isInternal = typeof caller === 'object' ? Boolean(caller?.isInternal) : false;
    const isAdmin = typeof caller === 'object' ? Boolean(caller?.isAdmin) : Boolean(caller);

    const order = await this.repo.findById(id);
    if (!order) throw new WholesaleNotFoundError(id);

    const isBuyer = order.userId === actorId;
    const isSeller = order.sellerId === actorId;

    if (isSeller && !isAdmin && !isInternal) {
      throw new UnauthorizedWholesaleActionError(
        'Sellers are not permitted to release escrow funds to themselves.',
      );
    }

    if (!isBuyer && !isAdmin && !isInternal) {
      throw new UnauthorizedWholesaleActionError(
        'Only the buyer, an administrator, or internal settlement can release escrow.',
      );
    }

    if (order.escrowStatus !== 'held') {
      throw new InvalidWholesaleRequestError(
        `Cannot release escrow when current escrow status is ${order.escrowStatus ?? 'none'}.`,
      );
    }

    // Atomic conditional update: only transitions if escrowStatus is currently 'held'
    const updated = await this.repo.updateEscrowStatusAtomic(id, ['held'], 'released');
    if (!updated) {
      throw new InvalidWholesaleRequestError(
        `Cannot release escrow: order "${id}" escrow status is no longer held or was already modified.`,
      );
    }

    return updated;
  }

  /**
   * Raise a Trade Assurance dispute; freezes escrow.
   */
  async disputeTradeAssurance(
    id: string,
    actorId: string,
    reason: string,
    caller?: AuthContext | boolean,
  ): Promise<WholesaleOrder> {
    const isInternal = typeof caller === 'object' ? Boolean(caller?.isInternal) : false;
    const isAdmin = typeof caller === 'object' ? Boolean(caller?.isAdmin) : Boolean(caller);

    const order = await this.getWholesaleOrder(id, actorId, isAdmin);

    if (order.escrowStatus !== 'held') {
      throw new InvalidWholesaleRequestError(
        `Cannot dispute escrow when current status is ${order.escrowStatus ?? 'none'}.`,
      );
    }

    const updated = await this.repo.updateEscrowStatusAtomic(id, ['held'], 'disputed', {
      cancellationReason: `Dispute: ${reason}`,
    });

    if (!updated) {
      throw new InvalidWholesaleRequestError(
        `Cannot dispute escrow: order "${id}" escrow status is no longer held.`,
      );
    }

    return updated;
  }

  /**
   * Refund escrowed funds back to the wholesale buyer upon dispute resolution.
   * Can only be executed by administrators or internal settlement.
   */
  async refundTradeAssuranceEscrow(
    id: string,
    reason: string,
    caller?: AuthContext | boolean,
  ): Promise<WholesaleOrder> {
    const isInternal = typeof caller === 'object' ? Boolean(caller?.isInternal) : false;
    const isAdmin = typeof caller === 'object' ? Boolean(caller?.isAdmin) : Boolean(caller);

    if (!isAdmin && !isInternal) {
      throw new UnauthorizedWholesaleActionError(
        'Refunding escrow is restricted to administrators or internal settlement services.',
      );
    }

    const order = await this.repo.findById(id);
    if (!order) throw new WholesaleNotFoundError(id);

    if (order.escrowStatus !== 'held' && order.escrowStatus !== 'disputed') {
      throw new InvalidWholesaleRequestError(
        `Cannot refund escrow when status is ${order.escrowStatus ?? 'none'}.`,
      );
    }

    const now = new Date().toISOString();
    const updated = await this.repo.updateStatusAtomic(
      id,
      ['APPROVED', 'PAID', 'DISPATCHED'],
      'CANCELLED',
      {
        escrowStatus: 'refunded',
        cancelledAt: now,
        cancellationReason: `Refunded: ${reason}`,
      },
    );

    if (!updated) {
      throw new InvalidWholesaleRequestError(
        `Cannot refund escrow: order "${id}" has already transitioned to a terminal state.`,
      );
    }

    return updated;
  }
}

export const wholesaleService = new WholesaleService();
