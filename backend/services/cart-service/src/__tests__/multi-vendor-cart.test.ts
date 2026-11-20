import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const store = new Map<string, string>();

const mockRedis = {
  get: jest.fn<(key: string) => Promise<string | null>>(async (key) => store.get(key) ?? null),
  set: jest.fn<(...args: any[]) => Promise<string>>(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  }),
  del: jest.fn<(key: string) => Promise<number>>(async (key) => (store.delete(key) ? 1 : 0)),
};

jest.unstable_mockModule('../utils/redis.js', () => ({ redis: mockRedis }));

const quote = jest.fn<(...args: any[]) => Promise<any>>(
  async () => ({ outcome: 'unavailable', reason: 'not stubbed' }),
);
jest.unstable_mockModule('../clients/discount.client.js', () => ({ quoteCoupon: quote }));

const stockFor = jest.fn<(...args: any[]) => Promise<number | null>>(async () => null);
const fetchOfferMock = jest.fn<(...args: any[]) => Promise<any>>(async () => null);
const stockForOfferMock = jest.fn<(...args: any[]) => Promise<number | null>>(async () => null);

jest.unstable_mockModule('../clients/catalog.client.js', () => ({
  availableStockFor: stockFor,
  fetchOfferDetails: fetchOfferMock,
  availableStockForOffer: stockForOfferMock,
}));

type CartModule = typeof import('../services/cart.service.js');
let CartService: CartModule['CartService'];
let CartMoqError: CartModule['CartMoqError'];
let CartOfferInactiveError: CartModule['CartOfferInactiveError'];
let CartQuantityError: CartModule['CartQuantityError'];
let cart: InstanceType<CartModule['CartService']>;

beforeEach(async () => {
  jest.clearAllMocks();
  store.clear();
  const mod = await import('../services/cart.service.js');
  CartService = mod.CartService;
  CartMoqError = mod.CartMoqError;
  CartOfferInactiveError = mod.CartOfferInactiveError;
  CartQuantityError = mod.CartQuantityError;
  cart = new CartService();
});

describe('Multi-Vendor Cart Integration', () => {
  const offerSeller1 = {
    id: 'offer-s1-p1',
    productId: 'prod-canonical-1',
    variantId: 'var-1',
    sellerId: 'seller-1',
    sellerSku: 'SKU-S1-001',
    price: 50000,
    currency: 'UGX',
    condition: 'NEW',
    moq: 1,
    stock: 20,
    reserved: 2,
    availableStock: 18,
    status: 'ACTIVE',
    product: {
      id: 'prod-canonical-1',
      name: 'Solar Inverter 5kVA',
      status: 'ACTIVE',
      thumbnail: 'https://cdn.munzi.ug/inverter.jpg',
    },
    variant: {
      id: 'var-1',
      sku: 'CANON-VAR-1',
      attributes: { capacity: '5kVA' },
    },
  };

  const offerSeller2 = {
    id: 'offer-s2-p1',
    productId: 'prod-canonical-1',
    variantId: 'var-1',
    sellerId: 'seller-2',
    sellerSku: 'SKU-S2-COMPETE',
    price: 48000,
    currency: 'UGX',
    condition: 'REFURBISHED',
    moq: 2,
    wholesaleTiers: [
      { minQuantity: 5, unitPrice: 45000 },
    ],
    stock: 10,
    reserved: 0,
    availableStock: 10,
    status: 'ACTIVE',
    product: {
      id: 'prod-canonical-1',
      name: 'Solar Inverter 5kVA',
      status: 'ACTIVE',
      thumbnail: 'https://cdn.munzi.ug/inverter.jpg',
    },
    variant: {
      id: 'var-1',
      sku: 'CANON-VAR-1',
      attributes: { capacity: '5kVA' },
    },
  };

  it('allows items from multiple sellers for the same canonical product to coexist without line collision', async () => {
    fetchOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'offer-s1-p1') return offerSeller1;
      if (offerId === 'offer-s2-p1') return offerSeller2;
      return null;
    });

    // Add offer from Seller 1
    const res1 = await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      variantId: 'var-1',
      offerId: 'offer-s1-p1',
      sellerId: 'untrusted-seller',
      productName: 'Solar Inverter',
      productImage: 'https://cdn.munzi.ug/default.jpg',
      price: 99999,
      quantity: 1,
      maxQuantity: 100,
    });

    expect(res1.items).toHaveLength(1);
    expect(res1.items[0].offerId).toBe('offer-s1-p1');
    expect(res1.items[0].sellerId).toBe('seller-1'); // Overridden to authoritative seller
    expect(res1.items[0].price).toBe(50000); // Overridden to authoritative price
    expect(res1.items[0].condition).toBe('NEW');

    // Add offer from Seller 2 for the EXACT same product and variant
    const res2 = await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      variantId: 'var-1',
      offerId: 'offer-s2-p1',
      sellerId: 'seller-2',
      productName: 'Solar Inverter',
      productImage: 'https://cdn.munzi.ug/default.jpg',
      price: 48000,
      quantity: 2,
      maxQuantity: 100,
    });

    // Items should NOT collide! Both must exist as separate cart items
    expect(res2.items).toHaveLength(2);
    expect(res2.items.map((i) => i.offerId)).toEqual(['offer-s1-p1', 'offer-s2-p1']);
    expect(res2.items.map((i) => i.sellerId)).toEqual(['seller-1', 'seller-2']);
    expect(res2.subtotal).toBe(50000 * 1 + 48000 * 2);
  });

  it('enforces MOQ requirements on offer add and update', async () => {
    fetchOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'offer-s2-p1') return offerSeller2; // MOQ is 2
      return null;
    });

    // Quantity 1 < MOQ 2
    await expect(
      cart.addItem('user-1', {
        productId: 'prod-canonical-1',
        offerId: 'offer-s2-p1',
        sellerId: 'seller-2',
        productName: 'Solar Inverter',
        productImage: 'img.jpg',
        price: 48000,
        quantity: 1,
        maxQuantity: 10,
      }),
    ).rejects.toThrow(CartMoqError);

    // Quantity 2 meets MOQ 2
    const res = await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      offerId: 'offer-s2-p1',
      sellerId: 'seller-2',
      productName: 'Solar Inverter',
      productImage: 'img.jpg',
      price: 48000,
      quantity: 2,
      maxQuantity: 10,
    });
    expect(res.items).toHaveLength(1);

    // Updating quantity to 1 < MOQ 2 fails
    const itemId = res.items[0].id;
    await expect(cart.updateItemQuantity('user-1', itemId, 1)).rejects.toThrow(CartMoqError);
  });

  it('applies wholesale tiers dynamically based on requested quantity', async () => {
    fetchOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'offer-s2-p1') return offerSeller2; // >= 5 units is 45000
      return null;
    });

    // Add 2 units at regular price 48000
    const res1 = await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      offerId: 'offer-s2-p1',
      sellerId: 'seller-2',
      productName: 'Solar Inverter',
      productImage: 'img.jpg',
      price: 48000,
      quantity: 2,
      maxQuantity: 10,
    });
    expect(res1.items[0].price).toBe(48000);

    // Update to 5 units: should qualify for wholesale tier of 45000
    const res2 = await cart.updateItemQuantity('user-1', res1.items[0].id, 5);
    expect(res2.items[0].quantity).toBe(5);
    expect(res2.items[0].price).toBe(45000);
    expect(res2.subtotal).toBe(225000);
  });

  it('rejects adding inactive offers or offers of inactive products', async () => {
    fetchOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'offer-inactive') {
        return { ...offerSeller1, id: 'offer-inactive', status: 'PAUSED' };
      }
      if (offerId === 'offer-inactive-prod') {
        return {
          ...offerSeller1,
          id: 'offer-inactive-prod',
          product: { ...offerSeller1.product, status: 'ARCHIVED' },
        };
      }
      return null;
    });

    await expect(
      cart.addItem('user-1', {
        productId: 'prod-canonical-1',
        offerId: 'offer-inactive',
        sellerId: 'seller-1',
        productName: 'Solar Inverter',
        productImage: 'img.jpg',
        price: 50000,
        quantity: 1,
        maxQuantity: 10,
      }),
    ).rejects.toThrow(CartOfferInactiveError);

    await expect(
      cart.addItem('user-1', {
        productId: 'prod-canonical-1',
        offerId: 'offer-inactive-prod',
        sellerId: 'seller-1',
        productName: 'Solar Inverter',
        productImage: 'img.jpg',
        price: 50000,
        quantity: 1,
        maxQuantity: 10,
      }),
    ).rejects.toThrow(CartOfferInactiveError);
  });

  it('getCartSummary groups items by authoritative seller with respective subtotals', async () => {
    fetchOfferMock.mockImplementation(async (offerId: string) => {
      if (offerId === 'offer-s1-p1') return offerSeller1;
      if (offerId === 'offer-s2-p1') return offerSeller2;
      return null;
    });

    await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      offerId: 'offer-s1-p1',
      sellerId: 'seller-1',
      productName: 'Solar Inverter',
      productImage: 'img.jpg',
      price: 50000,
      quantity: 2,
      maxQuantity: 10,
    });

    await cart.addItem('user-1', {
      productId: 'prod-canonical-1',
      offerId: 'offer-s2-p1',
      sellerId: 'seller-2',
      productName: 'Solar Inverter',
      productImage: 'img.jpg',
      price: 48000,
      quantity: 3,
      maxQuantity: 10,
    });

    const summary = await cart.getCartSummary('user-1');
    expect(summary.sellers).toHaveLength(2);

    const s1Group = summary.sellers.find((s: any) => s.sellerId === 'seller-1');
    const s2Group = summary.sellers.find((s: any) => s.sellerId === 'seller-2');

    expect(s1Group).toBeDefined();
    expect(s1Group.subtotal).toBe(100000);
    expect(s1Group.items).toHaveLength(1);

    expect(s2Group).toBeDefined();
    expect(s2Group.subtotal).toBe(144000);
    expect(s2Group.items).toHaveLength(1);

    expect(summary.subtotal).toBe(244000);
    expect(summary.itemCount).toBe(5);
  });
});
