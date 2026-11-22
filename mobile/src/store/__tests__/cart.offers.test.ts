import { configureStore } from '@reduxjs/toolkit';
import cartReducer, { addCartItemThunk, fetchCartThunk, setCart } from '../cart.slice';
import { cartApi, type AddCartItemInput, type Cart } from '@/api/cart.api';

jest.mock('@/api/cart.api', () => ({
  cartApi: {
    getCart: jest.fn(),
    addItem: jest.fn(),
    updateItem: jest.fn(),
    removeItem: jest.fn(),
    clearCart: jest.fn(),
  },
}));

describe('mobile cart slice - multi-vendor offer threading', () => {
  const mockedCartApi = cartApi as jest.Mocked<typeof cartApi>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes offerId to cartApi.addItem when adding an offer', async () => {
    const store = configureStore({
      reducer: { cart: cartReducer },
    });

    const input: AddCartItemInput = {
      productId: 'prod-42',
      sellerId: 'seller-competing',
      offerId: 'offer-winning-77',
      productName: 'Wireless Headphones',
      productImage: 'https://example.com/img.jpg',
      price: 49.99,
      quantity: 2,
      maxQuantity: 20,
      variantId: 'var-black',
      variantLabel: 'Black / M',
    };

    const mockCartResponse: Cart = {
      userId: 'user-123',
      items: [
        {
          id: 'cart-line-1',
          productId: 'prod-42',
          sellerId: 'seller-competing',
          offerId: 'offer-winning-77',
          productName: 'Wireless Headphones',
          productImage: 'https://example.com/img.jpg',
          price: 49.99,
          quantity: 2,
          maxQuantity: 20,
          variantId: 'var-black',
          variantLabel: 'Black / M',
        },
      ],
      couponDiscount: 0,
      subtotal: 99.98,
      itemCount: 2,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };

    mockedCartApi.addItem.mockResolvedValueOnce(mockCartResponse);

    const result = await store.dispatch(addCartItemThunk(input));

    expect(addCartItemThunk.fulfilled.match(result)).toBe(true);
    expect(mockedCartApi.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod-42',
        sellerId: 'seller-competing',
        offerId: 'offer-winning-77',
        price: 49.99,
        quantity: 2,
      }),
    );

    const state = store.getState().cart;
    expect(state.items).toHaveLength(1);
    expect(state.items[0].offerId).toBe('offer-winning-77');
    expect(state.items[0].sellerId).toBe('seller-competing');
    expect(state.subtotal).toBe(99.98);
  });

  it('supports legacy single-vendor items without offerId', async () => {
    const store = configureStore({
      reducer: { cart: cartReducer },
    });

    const legacyInput: AddCartItemInput = {
      productId: 'prod-legacy',
      sellerId: 'seller-origin',
      productName: 'Classic T-Shirt',
      productImage: 'https://example.com/tee.jpg',
      price: 15.0,
      quantity: 1,
      maxQuantity: 10,
    };

    const mockCartResponse: Cart = {
      userId: 'user-123',
      items: [
        {
          id: 'cart-line-legacy',
          productId: 'prod-legacy',
          sellerId: 'seller-origin',
          productName: 'Classic T-Shirt',
          productImage: 'https://example.com/tee.jpg',
          price: 15.0,
          quantity: 1,
          maxQuantity: 10,
        },
      ],
      couponDiscount: 0,
      subtotal: 15.0,
      itemCount: 1,
      updatedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    };

    mockedCartApi.addItem.mockResolvedValueOnce(mockCartResponse);

    const result = await store.dispatch(addCartItemThunk(legacyInput));

    expect(addCartItemThunk.fulfilled.match(result)).toBe(true);
    expect(mockedCartApi.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'prod-legacy',
        offerId: undefined,
      }),
    );

    const state = store.getState().cart;
    expect(state.items[0].offerId).toBeUndefined();
    expect(state.items[0].sellerId).toBe('seller-origin');
  });

  it('sets cart directly and preserves offerId on lines', () => {
    const store = configureStore({
      reducer: { cart: cartReducer },
    });

    const cartData: Cart = {
      userId: 'user-test',
      items: [
        {
          id: 'line-a',
          productId: 'p-1',
          sellerId: 's-1',
          offerId: 'o-winner-1',
          productName: 'Item 1',
          productImage: '',
          price: 10,
          quantity: 1,
          maxQuantity: 5,
        },
        {
          id: 'line-b',
          productId: 'p-2',
          sellerId: 's-2',
          offerId: 'o-winner-2',
          productName: 'Item 2',
          productImage: '',
          price: 25,
          quantity: 2,
          maxQuantity: 10,
        },
      ],
      couponDiscount: 0,
      subtotal: 60,
      itemCount: 3,
      updatedAt: '2026-11-21T00:00:00Z',
      expiresAt: '2026-11-22T00:00:00Z',
    };

    store.dispatch(setCart(cartData));

    const state = store.getState().cart;
    expect(state.items).toHaveLength(2);
    expect(state.items[0].offerId).toBe('o-winner-1');
    expect(state.items[1].offerId).toBe('o-winner-2');
    expect(state.subtotal).toBe(60);
  });
});
