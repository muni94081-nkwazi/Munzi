import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CheckoutSession } from '../models/checkout.model.js';

interface RecordedCall { url: string; method: string; body: unknown }
let calls: RecordedCall[] = [];
let routes: Array<[string, { ok: boolean; status: number; data: unknown }]> = [];

const mockCall = jest.fn(async (url: string, opts: { method?: string; body?: unknown }) => {
  calls.push({ url, method: opts.method ?? 'GET', body: opts.body });
  const hit = routes.find(([pattern]) => url.includes(pattern));
  if (!hit) return { ok: true, status: 200, data: {} };
  return hit[1];
});

jest.unstable_mockModule('../clients/service.client.js', () => ({
  call: mockCall,
  SERVICES: {
    cart: 'http://cart',
    product: 'http://product',
    inventory: 'http://inventory',
    payment: 'http://payment',
    order: 'http://order',
    tax: 'http://tax',
    shipping: 'http://shipping',
  },
  ServiceUnavailableError: class extends Error {},
}));

const sessionStore = new Map<string, CheckoutSession>();

jest.unstable_mockModule('../repositories/session.repository.js', () => ({
  sessionRepository: {
    save: jest.fn(async (s: CheckoutSession) => {
      sessionStore.set(s.id, JSON.parse(JSON.stringify(s)));
    }),
    find: jest.fn(async (id: string) => sessionStore.get(id) ?? null),
    findByUser: jest.fn(async (userId: string) =>
      [...sessionStore.values()].filter((s) => s.userId === userId)),
    acquireLock: jest.fn(async () => true),
    releaseLock: jest.fn(async () => undefined),
  },
  connectSessionStore: jest.fn(),
  disconnectSessionStore: jest.fn(),
  isSessionStoreReady: () => true,
}));

jest.unstable_mockModule('../utils/logger.js', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { runCheckoutSaga, OutOfStockError } = await import('../saga/checkout.saga.js');
const { priceCart } = await import('../services/pricing.service.js');

describe('Multi-Vendor Checkout & Saga Integration', () => {
  beforeEach(() => {
    calls = [];
    routes = [];
    sessionStore.clear();
    jest.clearAllMocks();
  });

  const offer1 = {
    id: 'offer-1',
    productId: 'prod-canonical',
    variantId: 'var-1',
    sellerId: 'seller-alpha',
    sellerSku: 'SKU-ALPHA-1',
    price: 30000,
    currency: 'UGX',
    condition: 'NEW',
    moq: 1,
    stock: 50,
    reserved: 0,
    availableStock: 50,
    status: 'ACTIVE',
    product: { id: 'prod-canonical', name: 'Coffee Beans 1kg', status: 'ACTIVE' },
    variant: { id: 'var-1', sku: 'COFFEE-1KG', weightKg: 1 },
  };

  const offer2 = {
    id: 'offer-2',
    productId: 'prod-canonical',
    variantId: 'var-1',
    sellerId: 'seller-beta',
    sellerSku: 'SKU-BETA-COMPETE',
    price: 28000,
    currency: 'UGX',
    condition: 'NEW',
    moq: 2,
    wholesaleTiers: [{ minQuantity: 5, unitPrice: 25000 }],
    stock: 20,
    reserved: 0,
    availableStock: 20,
    status: 'ACTIVE',
    product: { id: 'prod-canonical', name: 'Coffee Beans 1kg', status: 'ACTIVE' },
    variant: { id: 'var-1', sku: 'COFFEE-1KG', weightKg: 1 },
  };

  it('prices multi-vendor cart with authoritative offer pricing and wholesale tiers', async () => {
    routes = [
      ['/api/v1/cart', {
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              { productId: 'prod-canonical', offerId: 'offer-1', sellerId: 'untrusted-1', productName: 'Coffee', quantity: 2 },
              { productId: 'prod-canonical', offerId: 'offer-2', sellerId: 'untrusted-2', productName: 'Coffee', quantity: 5 },
            ],
          },
        },
      }],
      ['/api/v1/public/offers/offer-1', { ok: true, status: 200, data: { success: true, data: offer1 } }],
      ['/api/v1/public/offers/offer-2', { ok: true, status: 200, data: { success: true, data: offer2 } }],
      ['/shipping', { ok: true, status: 200, data: { totalCost: 5000, perSeller: { 'seller-alpha': 2500, 'seller-beta': 2500 } } }],
      ['/tax', { ok: true, status: 200, data: { totalTax: 0 } }],
    ];

    const priced = await priceCart('user-1', { address: 'Plot 42 Kampala Rd', city: 'Kampala', phone: '+256700000001' });

    expect(priced.items).toHaveLength(2);

    // Line 1: seller-alpha, regular unit price 30000
    const line1 = priced.items.find((i) => i.offerId === 'offer-1')!;
    expect(line1.sellerId).toBe('seller-alpha');
    expect(line1.unitPrice).toBe(30000);
    expect(line1.lineTotal).toBe(60000);

    // Line 2: seller-beta, wholesale tier unit price 25000 (quantity is 5)
    const line2 = priced.items.find((i) => i.offerId === 'offer-2')!;
    expect(line2.sellerId).toBe('seller-beta');
    expect(line2.unitPrice).toBe(25000);
    expect(line2.lineTotal).toBe(125000);

    expect(priced.subtotal).toBe(185000);
  });

  it('executes saga end-to-end with offer reservations, escrow breakdown, order creation, and deduct', async () => {
    routes = [
      ['/api/v1/cart', {
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              { productId: 'prod-canonical', offerId: 'offer-1', sellerId: 'seller-alpha', productName: 'Coffee Alpha', quantity: 1 },
              { productId: 'prod-canonical', offerId: 'offer-2', sellerId: 'seller-beta', productName: 'Coffee Beta', quantity: 2 },
            ],
          },
        },
      }],
      ['/api/v1/public/offers/offer-1', { ok: true, status: 200, data: { success: true, data: offer1 } }],
      ['/api/v1/public/offers/offer-2', { ok: true, status: 200, data: { success: true, data: offer2 } }],
      ['/api/v1/inventory/offers/offer-1/reserve', { ok: true, status: 200, data: { data: { reservationId: 'res-off-1' } } }],
      ['/api/v1/inventory/offers/offer-2/reserve', { ok: true, status: 200, data: { data: { reservationId: 'res-off-2' } } }],
      ['/api/v1/payments/initiate', { ok: true, status: 200, data: { data: { paymentId: 'pay-123', reference: 'ref-123', status: 'completed' } } }],
      ['/api/v1/orders', {
        ok: true,
        status: 201,
        data: {
          data: {
            id: 'ord-master-1',
            subOrders: [
              { id: 'sub-ord-1', sellerId: 'seller-alpha', vendorShare: 26100, platformCommission: 3900 },
              { id: 'sub-ord-2', sellerId: 'seller-beta', vendorShare: 48720, platformCommission: 7280 },
            ],
          },
        },
      }],
      ['/sub-orders', { ok: true, status: 200, data: { message: 'linked' } }],
      ['/api/v1/inventory/offers/offer-1/deduct', { ok: true, status: 200, data: { success: true } }],
      ['/api/v1/inventory/offers/offer-2/deduct', { ok: true, status: 200, data: { success: true } }],
    ];

    const session: CheckoutSession = {
      id: 'sess-mv-1',
      userId: 'user-1',
      status: 'INITIATED',
      cartSnapshot: null,
      shippingAddress: { address: 'Kampala', city: 'Kampala', phone: '+256700000001' },
      billingAddress: null,
      paymentMethod: { type: 'mtn_momo', phone: '+256770000000' },
      reservations: [],
      couponDiscount: 0,
      vendorDiscounts: {},
      shippingCost: 0,
      vendorShipping: {},
      taxAmount: 0,
      subtotal: 0,
      total: 0,
      steps: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = await runCheckoutSaga(session);

    expect(result.status).toBe('COMPLETED');
    expect(result.orderId).toBe('ord-master-1');

    // 1. Check offer reservations called
    const reserve1Call = calls.find((c) => c.url.includes('/api/v1/inventory/offers/offer-1/reserve'));
    const reserve2Call = calls.find((c) => c.url.includes('/api/v1/inventory/offers/offer-2/reserve'));
    expect(reserve1Call).toBeDefined();
    expect(reserve2Call).toBeDefined();

    // 2. Check payment initiate received multi-vendor breakdown
    const paymentCall = calls.find((c) => c.url.includes('/api/v1/payments/initiate'));
    expect(paymentCall).toBeDefined();
    const paymentBody = paymentCall!.body as any;
    expect(paymentBody.vendorBreakdown).toEqual([
      { sellerId: 'seller-alpha', amountUGX: 30000 },
      { sellerId: 'seller-beta', amountUGX: 56000 },
    ]);

    // 3. Check order-service received items with offerId and reservationId
    const orderCall = calls.find((c) => c.url.endsWith('/api/v1/orders'));
    expect(orderCall).toBeDefined();
    const orderBody = orderCall!.body as any;
    expect(orderBody.items).toHaveLength(2);
    expect(orderBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ offerId: 'offer-1', reservationId: 'res-off-1', sellerId: 'seller-alpha' }),
        expect.objectContaining({ offerId: 'offer-2', reservationId: 'res-off-2', sellerId: 'seller-beta' }),
      ]),
    );

    // 4. Check offer deducts called after order confirmation
    const deduct1Call = calls.find((c) => c.url.includes('/api/v1/inventory/offers/offer-1/deduct'));
    const deduct2Call = calls.find((c) => c.url.includes('/api/v1/inventory/offers/offer-2/deduct'));
    expect(deduct1Call).toBeDefined();
    expect(deduct2Call).toBeDefined();
  });

  it('unwinds offer reservations when an offer has insufficient stock', async () => {
    routes = [
      ['/api/v1/cart', {
        ok: true,
        status: 200,
        data: {
          success: true,
          data: {
            items: [
              { productId: 'prod-canonical', offerId: 'offer-1', sellerId: 'seller-alpha', productName: 'Coffee Alpha', quantity: 1 },
              { productId: 'prod-canonical', offerId: 'offer-2', sellerId: 'seller-beta', productName: 'Coffee Beta', quantity: 2 },
            ],
          },
        },
      }],
      ['/api/v1/public/offers/offer-1', { ok: true, status: 200, data: { success: true, data: offer1 } }],
      ['/api/v1/public/offers/offer-2', { ok: true, status: 200, data: { success: true, data: offer2 } }],
      // offer-1 reservation succeeds
      ['/api/v1/inventory/offers/offer-1/reserve', { ok: true, status: 200, data: { data: { reservationId: 'res-off-1' } } }],
      // offer-2 reservation fails with 409
      ['/api/v1/inventory/offers/offer-2/reserve', { ok: false, status: 409, data: { message: 'Only 0 available' } }],
      // offer-1 compensation release
      ['/api/v1/inventory/offers/offer-1/release', { ok: true, status: 200, data: { success: true } }],
    ];

    const session: CheckoutSession = {
      id: 'sess-mv-fail',
      userId: 'user-1',
      status: 'INITIATED',
      cartSnapshot: null,
      shippingAddress: { address: 'Kampala', city: 'Kampala', phone: '+256700000001' },
      billingAddress: null,
      paymentMethod: { type: 'mtn_momo' },
      reservations: [],
      couponDiscount: 0,
      vendorDiscounts: {},
      shippingCost: 0,
      vendorShipping: {},
      taxAmount: 0,
      subtotal: 0,
      total: 0,
      steps: [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await expect(runCheckoutSaga(session)).rejects.toThrow(OutOfStockError);

    // Verify release compensation was called for offer-1
    const releaseCall = calls.find((c) => c.url.includes('/api/v1/inventory/offers/offer-1/release'));
    expect(releaseCall).toBeDefined();
    expect((releaseCall!.body as any).reservationId).toBe('res-off-1');
  });
});
