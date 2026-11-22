import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
const del = vi.fn();

vi.mock('../axios.config', () => ({
  default: {
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    get: (...args: unknown[]) => get(...args),
    delete: (...args: unknown[]) => del(...args),
  },
}));

const { offersApi } = await import('../offers.api');

describe('offersApi Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls POST /seller/offers when creating an offer', async () => {
    post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 'off-123',
          productId: 'prod-1',
          variantId: 'var-1',
          price: 28000,
          condition: 'NEW',
          stock: 10,
        },
      },
    });

    const payload = {
      productId: 'prod-1',
      variantId: 'var-1',
      sellerSku: 'SKU-001',
      price: 28000,
      compareAtPrice: 32000,
      condition: 'NEW' as const,
      stock: 10,
      moq: 1,
    };

    const result = await offersApi.create(payload);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/seller/offers', payload);
    expect(result.id).toBe('off-123');
    expect(result.price).toBe(28000);
  });

  it('calls GET /seller/offers with query parameters when listing seller offers', async () => {
    get.mockResolvedValueOnce({
      data: {
        success: true,
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
        offers: [
          {
            id: 'off-123',
            price: 28000,
            isBuyBoxWinner: true,
          },
        ],
      },
    });

    const query = { status: 'ACTIVE', search: 'SKU-001', page: 1, limit: 10 };
    const result = await offersApi.listMyOffers(query);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/seller/offers', { params: query });
    expect(result.total).toBe(1);
    expect(result.offers[0].isBuyBoxWinner).toBe(true);
  });

  it('calls PUT /seller/offers/:id when updating an offer', async () => {
    put.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          id: 'off-123',
          price: 26000,
          stock: 15,
        },
      },
    });

    const updatePayload = { price: 26000, stock: 15 };
    const result = await offersApi.update('off-123', updatePayload);

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/seller/offers/off-123', updatePayload);
    expect(result.price).toBe(26000);
  });

  it('calls DELETE /seller/offers/:id when removing an offer', async () => {
    del.mockResolvedValueOnce({
      data: { success: true, message: 'Offer deleted successfully' },
    });

    const result = await offersApi.delete('off-123');

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith('/seller/offers/off-123');
    expect(result.success).toBe(true);
  });

  it('calls GET /products with query when searching catalog', async () => {
    get.mockResolvedValueOnce({
      data: {
        products: [{ id: 'prod-honey', name: 'Kasese Pure Honey' }],
      },
    });

    const results = await offersApi.searchCatalog('honey');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/products', {
      params: { q: 'honey', search: 'honey', limit: 10 },
    });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Kasese Pure Honey');
  });

  it('calls GET /products/:id/variants when fetching variants for an existing product', async () => {
    get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'var-1', sku: 'HNY-1L', price: 35000 }],
      },
    });

    const variants = await offersApi.getProductVariants('prod-honey');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/products/prod-honey/variants');
    expect(variants).toHaveLength(1);
    expect(variants[0].sku).toBe('HNY-1L');
  });
});
