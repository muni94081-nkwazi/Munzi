import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { Order, OrderItem } from '../models/order.model.js';
import type { IOrderRepository } from '../repositories/order.repository.js';

const mockPublish = jest.fn<() => Promise<void>>().mockResolvedValue();

jest.unstable_mockModule('../../../../shared/kafka/producer.js', () => ({
  publish: mockPublish,
  connectProducer: jest.fn<() => Promise<void>>().mockResolvedValue(),
  disconnectProducer: jest.fn<() => Promise<void>>().mockResolvedValue(),
  isProducerReady: jest.fn<() => boolean>().mockReturnValue(true),
}));

jest.unstable_mockModule('../db/mongoose.js', () => ({
  connectDB: () => Promise.resolve(),
  disconnectDB: () => Promise.resolve(),
  isDBReady: () => true,
}));

const mockBookDeliveryJob = jest.fn(async () => true);
jest.unstable_mockModule('../clients/fulfillment.client.js', () => ({
  bookDeliveryJob: mockBookDeliveryJob,
  BOOK_JOB_AT_STATUS: 'processing',
  fulfillmentClient: { bookDeliveryJob: mockBookDeliveryJob, BOOK_JOB_AT_STATUS: 'processing' },
}));

const offerStore = new Map<string, any>();
const mockFetchOffer = jest.fn(async (offerId: string, quantity: number) => {
  const offer = offerStore.get(offerId);
  if (!offer) throw new Error(`offer not found: ${offerId}`);
  let unitPrice = offer.price;
  if (offer.wholesaleTiers && offer.wholesaleTiers.length > 0) {
    const tier = offer.wholesaleTiers
      .sort((a: any, b: any) => b.minQuantity - a.minQuantity)
      .find((t: any) => quantity >= t.minQuantity);
    if (tier) unitPrice = tier.unitPrice;
  }
  return { ...offer, price: unitPrice };
});

const reserveOfferCalls: Array<{ offerId: string; quantity: number }> = [];
const mockReserveOfferStock = jest.fn(async (offerId: string, quantity: number) => {
  reserveOfferCalls.push({ offerId, quantity });
  return `res-off-${offerId}`;
});

const releaseOfferCalls: Array<{ offerId: string; reservationId: string }> = [];
const mockReleaseOfferStock = jest.fn(async (offerId: string, reservationId: string) => {
  releaseOfferCalls.push({ offerId, reservationId });
});

const deductOfferCalls: Array<{ offerId: string; quantity: number }> = [];
const mockDeductOfferStock = jest.fn(async (offerId: string, quantity: number) => {
  deductOfferCalls.push({ offerId, quantity });
});

jest.unstable_mockModule('../clients/catalog.client.js', () => ({
  fetchOffer: mockFetchOffer,
  fetchVariant: jest.fn(),
  fetchProduct: jest.fn(),
  reserveStock: jest.fn(),
  reserveOfferStock: mockReserveOfferStock,
  releaseStock: jest.fn(),
  releaseOfferStock: mockReleaseOfferStock,
  restoreStock: jest.fn(),
  deductStock: jest.fn(),
  deductOfferStock: mockDeductOfferStock,
  refundPayment: jest.fn(),
  ItemUnavailableError: class extends Error {},
  OutOfStockError: class extends Error {},
  CatalogUnavailableError: class extends Error {},
  StockSettlementError: class extends Error {},
}));

const orderService = await import('../services/order.service.js');
const { settlePaidOrder } = await import('../services/settlement.service.js');

describe('Multi-Vendor Order Integration', () => {
  let createdOrders: Order[] = [];

  const mockRepo: IOrderRepository = {
    create: jest.fn(async (o: Order) => {
      createdOrders.push(JSON.parse(JSON.stringify(o)));
      return o;
    }),
    findById: jest.fn(async (id: string) => createdOrders.find((o) => o.id === id) ?? null),
    findByUserId: jest.fn(async (id: string, userId: string) =>
      createdOrders.find((o) => o.id === id && o.userId === userId) ?? null),
    findByCheckoutSessionId: jest.fn(async (s: string) => createdOrders.find((o) => o.checkoutSessionId === s) ?? null),
    listByUser: jest.fn(async (u: string) => ({ data: createdOrders.filter((o) => o.userId === u), total: 1 })),
    replace: jest.fn(async (o: Order) => {
      const idx = createdOrders.findIndex((x) => x.id === o.id);
      if (idx >= 0) createdOrders[idx] = JSON.parse(JSON.stringify(o));
      return o;
    }),
    nextOrderNumber: jest.fn(async () => 'ORD-MV-1001'),
    listAll: jest.fn(async () => ({ data: createdOrders, total: createdOrders.length })),
    listSubOrdersBySeller: jest.fn(async () => ({ data: [], total: 0 })),
    findOrderContainingSubOrder: jest.fn(async () => null),
    adminStats: jest.fn(async () => ({} as any)),
    listRecent: jest.fn(async () => []),
  };

  beforeEach(() => {
    createdOrders = [];
    offerStore.clear();
    reserveOfferCalls.length = 0;
    releaseOfferCalls.length = 0;
    deductOfferCalls.length = 0;
    jest.clearAllMocks();

    offerStore.set('offer-alpha', {
      id: 'offer-alpha',
      productId: 'prod-canonical',
      variantId: 'var-canonical',
      sellerId: 'seller-alpha',
      sellerSku: 'SKU-A-100',
      price: 50000,
      currency: 'UGX',
      condition: 'NEW',
      moq: 1,
      stock: 20,
      reserved: 0,
      availableStock: 20,
      status: 'ACTIVE',
      productName: 'Solar Panel 200W',
      productSku: 'CANON-SOLAR-200W',
      productImageUrl: 'img-alpha.jpg',
      weightKg: 12,
    });

    offerStore.set('offer-beta', {
      id: 'offer-beta',
      productId: 'prod-canonical',
      variantId: 'var-canonical',
      sellerId: 'seller-beta',
      sellerSku: 'SKU-B-200',
      price: 45000,
      currency: 'UGX',
      condition: 'REFURBISHED',
      moq: 1,
      stock: 15,
      reserved: 0,
      availableStock: 15,
      status: 'ACTIVE',
      productName: 'Solar Panel 200W',
      productSku: 'CANON-SOLAR-200W',
      productImageUrl: 'img-beta.jpg',
      weightKg: 12,
    });
  });

  it('creates master order with seller-specific suborders for multi-vendor offers of same canonical product', async () => {
    const order = await orderService.create(
      {
        userId: 'buyer-1',
        sessionId: 'sess-mv-100',
        items: [
          { productId: 'prod-canonical', offerId: 'offer-alpha', quantity: 1, reservationId: 'res-a' },
          { productId: 'prod-canonical', offerId: 'offer-beta', quantity: 2, reservationId: 'res-b' },
        ],
        shipping: {
          address: 'Plot 10 Jinja Rd',
          city: 'Kampala',
          phone: '+256701234567',
        },
        vendorShippingFees: {
          'seller-alpha': 7000,
          'seller-beta': 6000,
        },
        vendorDiscounts: {
          'seller-alpha': 5000,
          'seller-beta': 0,
        },
      },
      mockRepo,
    );

    expect(order).toBeDefined();
    expect(order.subOrders).toHaveLength(2);

    // Alpha SubOrder
    const alphaSub = order.subOrders.find((so) => so.sellerId === 'seller-alpha')!;
    expect(alphaSub).toBeDefined();
    expect(alphaSub.items).toHaveLength(1);
    expect(alphaSub.items[0].offerId).toBe('offer-alpha');
    expect(alphaSub.items[0].sellerSku).toBe('SKU-A-100');
    expect(alphaSub.items[0].condition).toBe('NEW');
    expect(alphaSub.items[0].unitPrice).toBe(50000);
    expect(alphaSub.subtotal).toBe(50000);
    expect(alphaSub.shippingFee).toBe(7000);
    expect(alphaSub.discountAmount).toBe(5000);
    // net: 45000, commission 12.5% = 5625, vendorShare = 39375
    expect(alphaSub.totalAmount).toBe(45000 + 7000);

    // Beta SubOrder
    const betaSub = order.subOrders.find((so) => so.sellerId === 'seller-beta')!;
    expect(betaSub).toBeDefined();
    expect(betaSub.items).toHaveLength(1);
    expect(betaSub.items[0].offerId).toBe('offer-beta');
    expect(betaSub.items[0].sellerSku).toBe('SKU-B-200');
    expect(betaSub.items[0].condition).toBe('REFURBISHED');
    expect(betaSub.items[0].unitPrice).toBe(45000);
    expect(betaSub.items[0].quantity).toBe(2);
    expect(betaSub.subtotal).toBe(90000);
    expect(betaSub.shippingFee).toBe(6000);
    expect(betaSub.totalAmount).toBe(90000 + 6000);

    // Master order totals
    expect(order.subtotal).toBe(140000);
    expect(order.shippingFee).toBe(13000);
    expect(order.discountAmount).toBe(5000);
    expect(order.totalAmount).toBe(140000 + 13000 - 5000);
    expect(order.settlementPath).toBe('saga');
  });

  it('settles direct-path multi-vendor order using offer-specific inventory deduct', async () => {
    // Direct order path: no reservationId supplied
    const order = await orderService.create(
      {
        userId: 'buyer-2',
        items: [
          { productId: 'prod-canonical', offerId: 'offer-alpha', quantity: 2 },
          { productId: 'prod-canonical', offerId: 'offer-beta', quantity: 1 },
        ],
        shipping: {
          address: 'Plot 1 Entebbe Rd',
          city: 'Entebbe',
          phone: '+256701234567',
        },
      },
      mockRepo,
    );

    expect(order.settlementPath).toBe('direct');
    expect(reserveOfferCalls).toHaveLength(2);

    // Now simulate payment confirmation event driving direct settlement
    const outcome = await settlePaidOrder(order.id, 'PAY-DIRECT-1', mockRepo);
    expect(outcome.status).toBe('settled');
    expect(outcome.deducted).toHaveLength(2);
    expect(deductOfferCalls).toHaveLength(2);
    expect(deductOfferCalls).toEqual(
      expect.arrayContaining([
        { offerId: 'offer-alpha', quantity: 2 },
        { offerId: 'offer-beta', quantity: 1 },
      ]),
    );
  });
});
