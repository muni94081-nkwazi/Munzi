// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, withCurrency } from '@/test-utils/renderWithProviders';
import type { Product, ProductOffer, ProductVariant } from '@/types/product.types';

// Mock API modules
const getOffers = vi.fn();
const getReviews = vi.fn().mockResolvedValue({ data: [] });
const getVariants = vi.fn().mockResolvedValue([]);
const getBySlug = vi.fn();
const getStore = vi.fn();
const addItem = vi.fn().mockResolvedValue({ items: [], subtotal: 0, total: 0 });

vi.mock('@/api/products.api', () => ({
  productsApi: {
    getOffers: (...args: unknown[]) => getOffers(...args),
    getReviews: (...args: unknown[]) => getReviews(...args),
    getVariants: (...args: unknown[]) => getVariants(...args),
    getBySlug: (...args: unknown[]) => getBySlug(...args),
  },
}));

vi.mock('@/api/storefront.api', () => ({
  storefrontApi: {
    getStore: (...args: unknown[]) => getStore(...args),
  },
}));

vi.mock('@/api/cart.api', () => ({
  cartApi: {
    getCart: vi.fn().mockResolvedValue({ items: [], subtotal: 0, total: 0 }),
    addItem: (...args: unknown[]) => addItem(...args),
  },
}));

let mockSlug = 'kasese-pure-honey-1l';
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ slug: mockSlug }),
  };
});

const { ProductDetailPage } = await import('../ProductDetailPage');

function makeCanonicalProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-honey-1',
    name: 'Kasese Pure Wildflower Honey 1L',
    slug: 'kasese-pure-honey-1l',
    description: 'Raw pure organic wildflower honey harvested sustainably from Rwenzori foothills.',
    price: 35000,
    compareAtPrice: 40000,
    currency: 'UGX',
    stockQuantity: 50,
    inStock: true,
    imageUrls: ['/images/honey.jpg'],
    averageRating: 4.9,
    reviewCount: 12,
    sellerId: 'seller-canonical-id',
    seller: {
      id: 'seller-canonical-id',
      name: 'Kasese Bee Keepers',
      email: 'info@kasesebee.ug',
      rating: 4.8,
      totalSales: 150,
      isVerified: true,
      isOfficial: false,
      joinDate: '2024-01-01',
    },
    ...overrides,
  } as Product;
}

function makeOffer(overrides: Partial<ProductOffer> = {}): ProductOffer {
  return {
    id: 'off-1',
    productId: 'prod-honey-1',
    variantId: 'var-1',
    sellerId: 'seller-winner-id',
    sellerSku: 'HONEY-WINNER-SKU',
    price: 32000,
    compareAtPrice: 38000,
    currency: 'UGX',
    condition: 'NEW',
    conditionNote: null,
    moq: 1,
    wholesaleTiers: null,
    isBuyBoxWinner: false,
    status: 'ACTIVE',
    isInStock: true,
    stock: 25,
    reserved: 0,
    lowStockThreshold: 5,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ProductDetailPage — Multi-Vendor Storefront Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSlug = 'kasese-pure-honey-1l';
    getBySlug.mockResolvedValue(makeCanonicalProduct());

    getStore.mockImplementation((sellerId: string) => {
      if (sellerId === 'seller-winner-id') {
        return Promise.resolve({
          id: 'store-winner',
          userId: 'seller-winner-id',
          storeName: 'Rwenzori Honey Direct',
          rating: 4.9,
          verificationStatus: 'verified',
        });
      }
      if (sellerId === 'seller-alt-id') {
        return Promise.resolve({
          id: 'store-alt',
          userId: 'seller-alt-id',
          storeName: 'Kampala Organic Mart',
          rating: 4.7,
          verificationStatus: 'verified',
        });
      }
      return Promise.resolve({
        id: 'store-canonical',
        userId: 'seller-canonical-id',
        storeName: 'Kasese Bee Keepers',
        rating: 4.8,
        verificationStatus: 'verified',
      });
    });
  });

  it('renders Buy Box winning seller, winning price, and featured winner badge', async () => {
    const prod = makeCanonicalProduct();
    const winnerOffer = makeOffer({
      id: 'off-winner-101',
      sellerId: 'seller-winner-id',
      price: 30000,
      compareAtPrice: 38000,
      isBuyBoxWinner: true,
    });
    const competitorOffer = makeOffer({
      id: 'off-comp-102',
      sellerId: 'seller-alt-id',
      price: 34000,
      condition: 'NEW',
      isBuyBoxWinner: false,
    });

    getOffers.mockResolvedValue([winnerOffer, competitorOffer]);

    renderWithProviders(<ProductDetailPage />, {
      preloadedState: {
        products: {
          selectedProduct: prod,
          items: [],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          filters: {},
          status: 'succeeded',
          error: null,
          categories: [],
        },
        ...withCurrency('UGX'),
      },
    });

    // Verify Buy Box Winner price is displayed as primary price
    await waitFor(() => {
      const priceElem = document.querySelector('.price-tag');
      expect(priceElem?.textContent).toContain('30,000');
    });

    // Featured badge for Buy Box winner
    expect(screen.getByTestId('buybox-winner-badge')).toBeTruthy();
    expect(screen.getByText(/Featured Best Offer on Muni/i)).toBeTruthy();

    // Verify "Other Sellers on Muni" section lists competing sellers
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3, name: /Other Sellers on Muni/i })).toBeTruthy();
      expect(screen.getByText('2 offers')).toBeTruthy();
      expect(screen.getByText('Kampala Organic Mart')).toBeTruthy();
      expect(screen.getByText(/34,000/)).toBeTruthy();
    });
  });

  it('allows customer to switch to alternative seller and ensures alternative offer is added to cart', async () => {
    const user = userEvent.setup();
    const prod = makeCanonicalProduct();
    const winnerOffer = makeOffer({
      id: 'off-winner-101',
      sellerId: 'seller-winner-id',
      price: 30000,
      isBuyBoxWinner: true,
    });
    const competitorOffer = makeOffer({
      id: 'off-comp-102',
      sellerId: 'seller-alt-id',
      price: 34000,
      condition: 'USED_LIKE_NEW',
      isBuyBoxWinner: false,
    });

    getOffers.mockResolvedValue([winnerOffer, competitorOffer]);

    renderWithProviders(<ProductDetailPage />, {
      preloadedState: {
        products: {
          selectedProduct: prod,
          items: [],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          filters: {},
          status: 'succeeded',
          error: null,
          categories: [],
        },
        ...withCurrency('UGX'),
      },
    });

    // Select alternative seller's offer
    const selectAltBtn = await screen.findByRole('button', { name: /Select offer from/i });
    await user.click(selectAltBtn);

    // Primary buy box price updates to alternative offer's price: 34,000
    await waitFor(() => {
      const priceElem = document.querySelector('.price-tag');
      expect(priceElem?.textContent).toContain('34,000');
    });

    // Winner badge should no longer be present on the active selection
    expect(screen.queryByTestId('buybox-winner-badge')).toBeNull();

    // Now click main "Add to cart" button
    const addToCartBtn = screen.getByRole('button', { name: /^Add to cart$/i });
    await user.click(addToCartBtn);

    // Verify addItem received the ALTERNATIVE seller's offer details, NOT the winning offer's
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1));
    expect(addItem.mock.calls[0][0]).toMatchObject({
      productId: 'prod-honey-1',
      sellerId: 'seller-alt-id',
      offerId: 'off-comp-102',
      price: 34000,
    });
  });

  it('allows direct "Buy from Seller" button click which directly adds that seller offer to cart', async () => {
    const user = userEvent.setup();
    const prod = makeCanonicalProduct();
    const winnerOffer = makeOffer({
      id: 'off-winner-101',
      sellerId: 'seller-winner-id',
      price: 30000,
      isBuyBoxWinner: true,
    });
    const competitorOffer = makeOffer({
      id: 'off-comp-102',
      sellerId: 'seller-alt-id',
      price: 34000,
      condition: 'NEW',
      isBuyBoxWinner: false,
    });

    getOffers.mockResolvedValue([winnerOffer, competitorOffer]);

    renderWithProviders(<ProductDetailPage />, {
      preloadedState: {
        products: {
          selectedProduct: prod,
          items: [],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          filters: {},
          status: 'succeeded',
          error: null,
          categories: [],
        },
        ...withCurrency('UGX'),
      },
    });

    // Click direct "Buy from Seller" button for alternative seller
    const directBuyBtn = await screen.findByRole('button', { name: /Buy from Kampala Organic Mart/i });
    await user.click(directBuyBtn);

    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1));
    expect(addItem.mock.calls[0][0]).toMatchObject({
      productId: 'prod-honey-1',
      sellerId: 'seller-alt-id',
      offerId: 'off-comp-102',
      price: 34000,
    });
  });

  it('preserves existing product pages when no competing offers exist (backward compatibility)', async () => {
    const user = userEvent.setup();
    const prod = makeCanonicalProduct({ price: 35000 });

    getOffers.mockResolvedValue([]); // No offers returned

    renderWithProviders(<ProductDetailPage />, {
      preloadedState: {
        products: {
          selectedProduct: prod,
          items: [],
          meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
          filters: {},
          status: 'succeeded',
          error: null,
          categories: [],
        },
        ...withCurrency('UGX'),
      },
    });

    // Primary price is the product's base price: 35,000
    await waitFor(() => {
      const priceElem = document.querySelector('.price-tag');
      expect(priceElem?.textContent).toContain('35,000');
    });

    // No "Other Sellers on Muni" section
    expect(screen.queryByRole('heading', { level: 3, name: /Other Sellers on Muni/i })).toBeNull();
    expect(screen.queryByTestId('buybox-winner-badge')).toBeNull();

    // Adding to cart uses canonical seller without offerId
    const addToCartBtn = screen.getByRole('button', { name: /^Add to cart$/i });
    await user.click(addToCartBtn);

    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(1));
    expect(addItem.mock.calls[0][0]).toMatchObject({
      productId: 'prod-honey-1',
      sellerId: 'seller-canonical-id',
      price: 35000,
      offerId: undefined,
    });
  });
});
