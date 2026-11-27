import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { WholesaleOrder } from '../services/wholesale.service.js';
import type { IWholesaleRepository } from '../repositories/wholesale.repository.js';
import type { CatalogProduct, CatalogOffer } from '../clients/catalog.client.js';

class ItemUnavailableError extends Error {
  readonly status = 409;
  constructor(reference: string) {
    super(`"${reference}" is no longer available.`);
    this.name = 'ItemUnavailableError';
  }
}

const mockFetchProduct = jest.fn<(_id: string, _actorId?: string) => Promise<CatalogProduct>>();
const mockFetchOffer = jest.fn<(_id: string, _quantity: number, _actorId?: string) => Promise<CatalogOffer>>();

jest.unstable_mockModule('../clients/catalog.client.js', () => ({
  fetchProduct: mockFetchProduct,
  fetchOffer: mockFetchOffer,
  ItemUnavailableError,
}));

const {
  WholesaleService,
  InvalidWholesaleRequestError,
  WholesaleNotFoundError,
  UnauthorizedWholesaleActionError,
} = await import('../services/wholesale.service.js');

describe('WholesaleService & B2B Trade Settlement', () => {
  let mockRepo: jest.Mocked<IWholesaleRepository>;
  let wholesaleService: InstanceType<typeof WholesaleService>;
  let inMemoryStore: Map<string, WholesaleOrder>;

  beforeEach(() => {
    jest.clearAllMocks();
    inMemoryStore = new Map();

    mockRepo = {
      create: jest.fn(async (order: WholesaleOrder) => {
        inMemoryStore.set(order.id, { ...order });
        return { ...order };
      }),
      findById: jest.fn(async (id: string) => {
        return inMemoryStore.get(id) ? { ...inMemoryStore.get(id)! } : null;
      }),
      findByUserId: jest.fn(async (id: string, userId: string) => {
        const order = inMemoryStore.get(id);
        if (order && order.userId === userId) return { ...order };
        return null;
      }),
      listByUserId: jest.fn(async (userId: string) => {
        return [...inMemoryStore.values()].filter((o) => o.userId === userId);
      }),
      listBySellerId: jest.fn(async (sellerId: string) => {
        return [...inMemoryStore.values()].filter((o) => o.sellerId === sellerId);
      }),
      updateStatus: jest.fn(async (id: string, status: WholesaleOrder['status'], extra?: Partial<WholesaleOrder>) => {
        const existing = inMemoryStore.get(id);
        if (!existing) return null;
        const updated = { ...existing, status, ...extra, updatedAt: new Date().toISOString() };
        inMemoryStore.set(id, updated);
        return updated;
      }),
      updateEscrowStatus: jest.fn(async (id: string, escrowStatus: NonNullable<WholesaleOrder['escrowStatus']>) => {
        const existing = inMemoryStore.get(id);
        if (!existing) return null;
        const updated = { ...existing, escrowStatus, updatedAt: new Date().toISOString() };
        inMemoryStore.set(id, updated);
        return updated;
      }),
      updateStatusAtomic: jest.fn(async (
        id: string,
        allowedCurrentStatuses: WholesaleOrder['status'][],
        targetStatus: WholesaleOrder['status'],
        extra?: Partial<WholesaleOrder>,
      ) => {
        const existing = inMemoryStore.get(id);
        if (!existing) return null;
        if (!allowedCurrentStatuses.includes(existing.status)) return null;
        const now = new Date().toISOString();
        const updated: WholesaleOrder = {
          ...existing,
          status: targetStatus,
          updatedAt: now,
          ...extra,
        };
        if (targetStatus === 'PAID' && !updated.paidAt) updated.paidAt = now;
        if (targetStatus === 'DISPATCHED' && !updated.shippedAt) updated.shippedAt = now;
        if (targetStatus === 'DELIVERED' && !updated.deliveredAt) updated.deliveredAt = now;
        if (targetStatus === 'CANCELLED' && !updated.cancelledAt) updated.cancelledAt = now;
        inMemoryStore.set(id, updated);
        return updated;
      }),
      updateEscrowStatusAtomic: jest.fn(async (
        id: string,
        allowedCurrentStatuses: NonNullable<WholesaleOrder['escrowStatus']>[],
        targetEscrowStatus: NonNullable<WholesaleOrder['escrowStatus']>,
        extra?: Partial<WholesaleOrder>,
      ) => {
        const existing = inMemoryStore.get(id);
        if (!existing) return null;
        if (!existing.escrowStatus || !allowedCurrentStatuses.includes(existing.escrowStatus)) return null;
        const now = new Date().toISOString();
        const updated: WholesaleOrder = {
          ...existing,
          escrowStatus: targetEscrowStatus,
          updatedAt: now,
          ...extra,
        };
        inMemoryStore.set(id, updated);
        return updated;
      }),
    };

    wholesaleService = new WholesaleService(mockRepo);
  });

  describe('getWholesaleTiers', () => {
    it('returns standard tier bands priced from catalogue product basePrice', async () => {
      mockFetchProduct.mockResolvedValueOnce({
        id: 'prod-100',
        name: 'Bulk Arabica Coffee Beans',
        basePrice: 50_000,
        sellerId: 'seller-coffee',
        currency: 'UGX',
      });

      const tiers = await wholesaleService.getWholesaleTiers('prod-100');

      expect(tiers).toHaveLength(4);
      expect(tiers[0]).toEqual({ minQty: 1, maxQty: 9, discountPercent: 0, unitPrice: 50_000 });
      expect(tiers[1]).toEqual({ minQty: 10, maxQty: 49, discountPercent: 10, unitPrice: 45_000 });
      expect(tiers[2]).toEqual({ minQty: 50, maxQty: 99, discountPercent: 18, unitPrice: 41_000 });
      expect(tiers[3]).toEqual({ minQty: 100, maxQty: undefined, discountPercent: 25, unitPrice: 37_500 });
    });

    it('returns dynamic volume tiers when offerId is specified with custom wholesale tiers', async () => {
      mockFetchOffer.mockResolvedValueOnce({
        id: 'offer-b2b',
        productId: 'prod-100',
        variantId: 'var-1',
        sellerId: 'seller-wholesale',
        price: 48_000,
        currency: 'UGX',
        condition: 'NEW',
        moq: 20,
        wholesaleTiers: [
          { minQuantity: 20, unitPrice: 44_000 },
          { minQuantity: 100, unitPrice: 38_000 },
          { minQuantity: 500, unitPrice: 32_000 },
        ],
        stock: 5000,
        reserved: 0,
        availableStock: 5000,
        status: 'ACTIVE',
        productName: 'Bulk Arabica Coffee Beans',
        productSku: 'COF-AR-001',
        productImageUrl: null,
      });

      const tiers = await wholesaleService.getWholesaleTiers('prod-100', 'offer-b2b');

      expect(tiers).toHaveLength(3);
      expect(tiers[0]).toEqual({
        minQty: 20,
        maxQty: 99,
        discountPercent: 8,
        unitPrice: 44_000,
      });
      expect(tiers[1]).toEqual({
        minQty: 100,
        maxQty: 499,
        discountPercent: 21,
        unitPrice: 38_000,
      });
      expect(tiers[2]).toEqual({
        minQty: 500,
        maxQty: undefined,
        discountPercent: 33,
        unitPrice: 32_000,
      });
    });
  });

  describe('createWholesaleOrder & MOQ Enforcement', () => {
    it('rejects non-integer or zero quantity', async () => {
      await expect(
        wholesaleService.createWholesaleOrder('buyer-1', 'prod-100', 0),
      ).rejects.toThrow(InvalidWholesaleRequestError);

      await expect(
        wholesaleService.createWholesaleOrder('buyer-1', 'prod-100', 2.5),
      ).rejects.toThrow('Quantity must be a whole number of at least 1.');
    });

    it('enforces MOQ when offerId has a minimum order requirement', async () => {
      mockFetchOffer.mockResolvedValueOnce({
        id: 'offer-moq-50',
        productId: 'prod-100',
        variantId: 'var-1',
        sellerId: 'seller-bulk',
        price: 40_000,
        currency: 'UGX',
        condition: 'NEW',
        moq: 50,
        wholesaleTiers: [{ minQuantity: 50, unitPrice: 40_000 }],
        stock: 1000,
        reserved: 0,
        availableStock: 1000,
        status: 'ACTIVE',
        productName: 'Bulk Cotton Fabric',
        productSku: 'COT-01',
        productImageUrl: null,
      });

      await expect(
        wholesaleService.createWholesaleOrder('buyer-1', 'prod-100', 25, { offerId: 'offer-moq-50' }),
      ).rejects.toThrow('Quantity 25 is below the minimum order quantity (MOQ) of 50.');
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('creates wholesale order with dynamic offer tier pricing and persists to repository', async () => {
      mockFetchOffer.mockResolvedValueOnce({
        id: 'offer-b2b',
        productId: 'prod-100',
        variantId: 'var-1',
        sellerId: 'seller-factory',
        price: 38_000, // resolved price for qty=120
        currency: 'UGX',
        condition: 'NEW',
        moq: 20,
        wholesaleTiers: [
          { minQuantity: 20, unitPrice: 44_000 },
          { minQuantity: 100, unitPrice: 38_000 },
        ],
        stock: 2000,
        reserved: 0,
        availableStock: 2000,
        status: 'ACTIVE',
        productName: 'Solar Inverters 5KW',
        productSku: 'SOL-5KW',
        productImageUrl: null,
      });

      const order = await wholesaleService.createWholesaleOrder('buyer-biz-99', 'prod-100', 120, {
        offerId: 'offer-b2b',
        paymentTerms: 'DEPOSIT_MILESTONE',
        tradeAssurance: true,
        shippingAddress: {
          address: 'Plot 44 Industrial Area',
          city: 'Kampala',
          country: 'Uganda',
          phone: '+256700112233',
          contactName: 'James Okello',
        },
      });

      expect(mockRepo.create).toHaveBeenCalledTimes(1);
      expect(order.id).toMatch(/^WS-[A-F0-9]{8}$/);
      expect(order.orderNumber).toMatch(/^MUNI-WS-[A-F0-9]{8}$/);
      expect(order.userId).toBe('buyer-biz-99');
      expect(order.sellerId).toBe('seller-factory');
      expect(order.offerId).toBe('offer-b2b');
      expect(order.quantity).toBe(120);
      expect(order.unitPrice).toBe(38_000);
      expect(order.totalPrice).toBe(120 * 38_000); // 4,560,000
      expect(order.depositAmount).toBe(Math.round(4_560_000 * 0.3)); // 30% milestone deposit
      expect(order.tradeAssurance).toBe(true);
      expect(order.escrowStatus).toBe('pending');
      expect(order.status).toBe('APPROVED');
      expect(order.shippingAddress?.contactName).toBe('James Okello');
    });

    it('creates standard catalogue wholesale order without offerId', async () => {
      mockFetchProduct.mockResolvedValueOnce({
        id: 'prod-tea',
        name: 'Organic Green Tea (Bulk)',
        basePrice: 10_000,
        sellerId: 'seller-tea-estate',
        currency: 'UGX',
      });

      const order = await wholesaleService.createWholesaleOrder('buyer-tea', 'prod-tea', 60);

      expect(order.unitPrice).toBe(8_200); // 18% off 10,000
      expect(order.discountPercentage).toBe(18);
      expect(order.totalPrice).toBe(492_000);
      expect(order.sellerId).toBe('seller-tea-estate');
      expect(order.paymentTerms).toBe('FULL_UPFRONT');
      expect(order.depositAmount).toBe(492_000);
    });
  });

  describe('Order Retrieval & Access Control', () => {
    it('lists orders by buyer userId', async () => {
      const orderA: WholesaleOrder = {
        id: 'WS-11',
        userId: 'buyer-alpha',
        productId: 'p-1',
        quantity: 50,
        unitPrice: 1000,
        discountPercentage: 10,
        totalPrice: 50000,
        status: 'APPROVED',
        createdAt: '2026-11-20T00:00:00Z',
      };
      const orderB: WholesaleOrder = {
        id: 'WS-22',
        userId: 'buyer-beta',
        productId: 'p-2',
        quantity: 20,
        unitPrice: 2000,
        discountPercentage: 0,
        totalPrice: 40000,
        status: 'APPROVED',
        createdAt: '2026-11-21T00:00:00Z',
      };
      inMemoryStore.set(orderA.id, orderA);
      inMemoryStore.set(orderB.id, orderB);

      const alphaOrders = await wholesaleService.listWholesaleOrders('buyer-alpha');
      expect(alphaOrders).toHaveLength(1);
      expect(alphaOrders[0].id).toBe('WS-11');
    });

    it('allows buyer, seller, and admin to view order, rejects outsiders', async () => {
      const order: WholesaleOrder = {
        id: 'WS-TARGET',
        userId: 'buyer-owner',
        sellerId: 'seller-vendor',
        productId: 'p-1',
        quantity: 100,
        unitPrice: 500,
        discountPercentage: 20,
        totalPrice: 50000,
        status: 'APPROVED',
        createdAt: new Date().toISOString(),
      };
      inMemoryStore.set(order.id, order);

      // Buyer access
      const byBuyer = await wholesaleService.getWholesaleOrder('WS-TARGET', 'buyer-owner');
      expect(byBuyer.id).toBe('WS-TARGET');

      // Seller access
      const bySeller = await wholesaleService.getWholesaleOrder('WS-TARGET', 'seller-vendor');
      expect(bySeller.id).toBe('WS-TARGET');

      // Admin access
      const byAdmin = await wholesaleService.getWholesaleOrder('WS-TARGET', 'admin-user', true);
      expect(byAdmin.id).toBe('WS-TARGET');

      // Unauthorized third party
      await expect(
        wholesaleService.getWholesaleOrder('WS-TARGET', 'unrelated-user', false),
      ).rejects.toThrow(UnauthorizedWholesaleActionError);
    });

    it('throws 404 when order does not exist', async () => {
      await expect(
        wholesaleService.getWholesaleOrder('WS-UNKNOWN', 'buyer-1'),
      ).rejects.toThrow(WholesaleNotFoundError);
    });
  });

  describe('Trade Settlement & Escrow Lifecycle Hardening', () => {
    let testOrder: WholesaleOrder;

    beforeEach(() => {
      testOrder = {
        id: 'WS-SETTLE-1',
        userId: 'buyer-corp',
        sellerId: 'seller-mfg',
        productId: 'prod-industrial',
        quantity: 200,
        unitPrice: 50_000,
        discountPercentage: 25,
        totalPrice: 10_000_000,
        currency: 'UGX',
        status: 'APPROVED',
        tradeAssurance: true,
        escrowStatus: 'pending',
        depositAmount: 10_000_000,
        createdAt: '2026-11-25T00:00:00Z',
      };
      inMemoryStore.set(testOrder.id, testOrder);
    });

    describe('confirmTradeAssurancePayment', () => {
      it('confirms payment when called by authorized internal service or administrator', async () => {
        // Internal caller
        const paidInternal = await wholesaleService.confirmTradeAssurancePayment(
          'WS-SETTLE-1',
          'PAY-REF-INTERNAL',
          { isInternal: true },
        );
        expect(paidInternal.status).toBe('PAID');
        expect(paidInternal.escrowStatus).toBe('held');
        expect(paidInternal.paidAt).toBeDefined();

        // Reset to APPROVED for admin test
        testOrder.status = 'APPROVED';
        testOrder.escrowStatus = 'pending';
        inMemoryStore.set(testOrder.id, testOrder);

        // Admin caller
        const paidAdmin = await wholesaleService.confirmTradeAssurancePayment(
          'WS-SETTLE-1',
          'PAY-REF-ADMIN',
          { isAdmin: true },
        );
        expect(paidAdmin.status).toBe('PAID');
        expect(paidAdmin.escrowStatus).toBe('held');
      });

      it('rejects unauthorized payment confirmation from buyer, seller, or unauthenticated client', async () => {
        await expect(
          wholesaleService.confirmTradeAssurancePayment('WS-SETTLE-1', 'PAY-CLIENT-UNAUTH'),
        ).rejects.toThrow(UnauthorizedWholesaleActionError);

        await expect(
          wholesaleService.confirmTradeAssurancePayment('WS-SETTLE-1', 'PAY-CLIENT-UNAUTH', { isInternal: false, isAdmin: false }),
        ).rejects.toThrow(UnauthorizedWholesaleActionError);
      });

      it('rejects payment confirmation if order is not in PENDING or APPROVED state (idempotency / atomic check)', async () => {
        testOrder.status = 'DISPATCHED';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.confirmTradeAssurancePayment('WS-SETTLE-1', 'REF', { isInternal: true }),
        ).rejects.toThrow(InvalidWholesaleRequestError);
      });
    });

    describe('releaseTradeAssuranceEscrow', () => {
      beforeEach(() => {
        testOrder.status = 'DELIVERED';
        testOrder.escrowStatus = 'held';
        inMemoryStore.set(testOrder.id, testOrder);
      });

      it('STRICT SECURITY: rejects seller attempting to release escrow funds to themselves', async () => {
        await expect(
          wholesaleService.releaseTradeAssuranceEscrow('WS-SETTLE-1', 'seller-mfg'),
        ).rejects.toThrow('Sellers are not permitted to release escrow funds to themselves.');
      });

      it('allows buyer to release escrow upon accepting delivery', async () => {
        const settled = await wholesaleService.releaseTradeAssuranceEscrow('WS-SETTLE-1', 'buyer-corp');
        expect(settled.escrowStatus).toBe('released');
      });

      it('allows admin or internal settlement service to release escrow', async () => {
        const adminSettled = await wholesaleService.releaseTradeAssuranceEscrow(
          'WS-SETTLE-1',
          'admin-user',
          { isAdmin: true },
        );
        expect(adminSettled.escrowStatus).toBe('released');

        // Reset and test internal service
        testOrder.escrowStatus = 'held';
        inMemoryStore.set(testOrder.id, testOrder);

        const internalSettled = await wholesaleService.releaseTradeAssuranceEscrow(
          'WS-SETTLE-1',
          'internal-worker',
          { isInternal: true },
        );
        expect(internalSettled.escrowStatus).toBe('released');
      });

      it('rejects unrelated third-party from releasing escrow', async () => {
        await expect(
          wholesaleService.releaseTradeAssuranceEscrow('WS-SETTLE-1', 'unrelated-user'),
        ).rejects.toThrow(UnauthorizedWholesaleActionError);
      });

      it('prevents double release (atomic conditional check returns 422)', async () => {
        // First release succeeds
        await wholesaleService.releaseTradeAssuranceEscrow('WS-SETTLE-1', 'buyer-corp');

        // Second release must fail because escrowStatus is now 'released', not 'held'
        await expect(
          wholesaleService.releaseTradeAssuranceEscrow('WS-SETTLE-1', 'buyer-corp'),
        ).rejects.toThrow(InvalidWholesaleRequestError);
      });
    });

    describe('Role-Based Order Status Transitions & Atomic Checks', () => {
      it('allows seller to mark order DISPATCHED from APPROVED', async () => {
        const dispatched = await wholesaleService.updateOrderStatus(
          'WS-SETTLE-1',
          'DISPATCHED',
          'seller-mfg',
        );
        expect(dispatched.status).toBe('DISPATCHED');
        expect(dispatched.shippedAt).toBeDefined();
      });

      it('rejects buyer attempting to mark order DISPATCHED', async () => {
        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'DISPATCHED', 'buyer-corp'),
        ).rejects.toThrow('Only the seller or an administrator can dispatch this order.');
      });

      it('allows buyer to mark order DELIVERED once DISPATCHED', async () => {
        testOrder.status = 'DISPATCHED';
        inMemoryStore.set(testOrder.id, testOrder);

        const delivered = await wholesaleService.updateOrderStatus(
          'WS-SETTLE-1',
          'DELIVERED',
          'buyer-corp',
        );
        expect(delivered.status).toBe('DELIVERED');
        expect(delivered.deliveredAt).toBeDefined();
      });

      it('rejects seller attempting to mark order DELIVERED', async () => {
        testOrder.status = 'DISPATCHED';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'DELIVERED', 'seller-mfg'),
        ).rejects.toThrow('Only the buyer or an administrator can confirm delivery.');
      });

      it('rejects marking DELIVERED if order is not yet DISPATCHED', async () => {
        testOrder.status = 'APPROVED';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'DELIVERED', 'buyer-corp'),
        ).rejects.toThrow('Cannot mark order delivered when status is "APPROVED". Order must be DISPATCHED first.');
      });

      it('rejects direct transition to PAID via updateOrderStatus', async () => {
        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'PAID', 'buyer-corp'),
        ).rejects.toThrow('Cannot transition to PAID directly; use authorized payment confirmation.');
      });

      it('enforces cancellation rules: buyer can cancel while APPROVED, but not once DISPATCHED', async () => {
        // Buyer cancels while APPROVED
        const cancelled = await wholesaleService.updateOrderStatus(
          'WS-SETTLE-1',
          'CANCELLED',
          'buyer-corp',
        );
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.cancelledAt).toBeDefined();

        // Reset to DISPATCHED
        testOrder.status = 'DISPATCHED';
        inMemoryStore.set(testOrder.id, testOrder);

        // Buyer cannot cancel once DISPATCHED
        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'CANCELLED', 'buyer-corp'),
        ).rejects.toThrow('Cannot cancel an order that has already been dispatched. Raise a dispute instead.');
      });

      it('enforces cancellation rules: seller requires a cancellation reason', async () => {
        // Without reason -> rejected
        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'CANCELLED', 'seller-mfg'),
        ).rejects.toThrow('A cancellation reason is required for seller cancellations.');

        // With reason -> accepted
        const cancelled = await wholesaleService.updateOrderStatus(
          'WS-SETTLE-1',
          'CANCELLED',
          'seller-mfg',
          'Out of stock at supplier warehouse',
        );
        expect(cancelled.status).toBe('CANCELLED');
        expect(cancelled.cancellationReason).toBe('Out of stock at supplier warehouse');
      });

      it('terminal state check: rejects modifications to already DELIVERED or CANCELLED order', async () => {
        testOrder.status = 'DELIVERED';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'CANCELLED', 'admin-user', undefined, true),
        ).rejects.toThrow('Cannot change status of an already delivered wholesale order.');

        testOrder.status = 'CANCELLED';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'APPROVED', 'seller-mfg'),
        ).rejects.toThrow('Cannot change status of an already cancelled wholesale order.');
      });

      it('handles atomic update conflict safely when database condition fails', async () => {
        // Force mockRepo.updateStatusAtomic to return null (simulating concurrent update conflict)
        mockRepo.updateStatusAtomic.mockResolvedValueOnce(null);

        await expect(
          wholesaleService.updateOrderStatus('WS-SETTLE-1', 'DISPATCHED', 'seller-mfg'),
        ).rejects.toThrow(InvalidWholesaleRequestError);
      });
    });

    describe('Disputes & Escrow Refunds', () => {
      beforeEach(() => {
        testOrder.escrowStatus = 'held';
        inMemoryStore.set(testOrder.id, testOrder);
      });

      it('handles Trade Assurance dispute: freezes escrow and records dispute reason', async () => {
        const disputed = await wholesaleService.disputeTradeAssurance(
          'WS-SETTLE-1',
          'buyer-corp',
          'Packaging damaged, 40 units non-functional',
        );

        expect(disputed.escrowStatus).toBe('disputed');
        expect(disputed.cancellationReason).toContain('Packaging damaged');
      });

      it('rejects non-admin/non-internal caller from executing escrow refund', async () => {
        testOrder.escrowStatus = 'disputed';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.refundTradeAssuranceEscrow('WS-SETTLE-1', 'Refund requested by user'),
        ).rejects.toThrow(UnauthorizedWholesaleActionError);
      });

      it('refunds escrowed funds when authorized by admin or internal settlement', async () => {
        testOrder.escrowStatus = 'disputed';
        inMemoryStore.set(testOrder.id, testOrder);

        const refunded = await wholesaleService.refundTradeAssuranceEscrow(
          'WS-SETTLE-1',
          'Dispute approved by Trade Assurance mediator',
          { isAdmin: true },
        );

        expect(refunded.status).toBe('CANCELLED');
        expect(refunded.escrowStatus).toBe('refunded');
        expect(refunded.cancellationReason).toContain('Dispute approved');
      });

      it('handles atomic update conflict safely on dispute when escrow is no longer held', async () => {
        // Escrow status changed to released
        testOrder.escrowStatus = 'released';
        inMemoryStore.set(testOrder.id, testOrder);

        await expect(
          wholesaleService.disputeTradeAssurance('WS-SETTLE-1', 'buyer-corp', 'Late delivery'),
        ).rejects.toThrow(InvalidWholesaleRequestError);
      });
    });
  });
});
