import { productsApi } from '../products.api';
import { apiClient } from '../client';
import type { ProductOffer, BuyBoxResult } from '@/types';

jest.mock('../client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe('mobile productsApi - multi-vendor offers and buybox', () => {
  const mockedGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getProductOffers', () => {
    it('calls /api/v1/products/:id/offers when no variant is supplied', async () => {
      const mockOffers: ProductOffer[] = [
        {
          id: 'offer-1',
          productId: 'prod-100',
          sellerId: 'seller-abc',
          sellerSku: 'SKU-001',
          price: 19.99,
          currency: 'USD',
          condition: 'NEW',
          isBuyBoxWinner: true,
          status: 'ACTIVE',
          stock: 50,
          isInStock: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockedGet.mockResolvedValueOnce({
        data: { success: true, offers: mockOffers },
      });

      const result = await productsApi.getProductOffers('prod-100');

      expect(mockedGet).toHaveBeenCalledWith('/api/v1/products/prod-100/offers');
      expect(result).toEqual(mockOffers);
      expect(result[0].isBuyBoxWinner).toBe(true);
    });

    it('calls /api/v1/products/:id/variants/:variantId/offers when variantId is provided', async () => {
      const mockOffers: ProductOffer[] = [
        {
          id: 'offer-v1',
          productId: 'prod-100',
          variantId: 'var-99',
          sellerId: 'seller-xyz',
          sellerSku: 'SKU-VAR-99',
          price: 24.5,
          currency: 'USD',
          condition: 'REFURBISHED',
          conditionNote: 'Minor cosmetic blemish',
          isBuyBoxWinner: false,
          status: 'ACTIVE',
          stock: 12,
          isInStock: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockedGet.mockResolvedValueOnce({
        data: { success: true, offers: mockOffers },
      });

      const result = await productsApi.getProductOffers('prod-100', 'var-99');

      expect(mockedGet).toHaveBeenCalledWith('/api/v1/products/prod-100/variants/var-99/offers');
      expect(result).toHaveLength(1);
      expect(result[0].condition).toBe('REFURBISHED');
      expect(result[0].conditionNote).toBe('Minor cosmetic blemish');
    });

    it('returns empty array when api response contains no offers', async () => {
      mockedGet.mockResolvedValueOnce({
        data: { success: true, offers: undefined },
      });

      const result = await productsApi.getProductOffers('prod-empty');
      expect(result).toEqual([]);
    });
  });

  describe('getBuyBox', () => {
    it('calls /api/v1/products/:id/buybox for canonical product', async () => {
      const mockBuyBox: BuyBoxResult = {
        productId: 'prod-100',
        winnerOfferId: 'offer-1',
        sellerId: 'seller-abc',
        price: 19.99,
        condition: 'NEW',
        currency: 'USD',
        isCalculated: true,
      };

      mockedGet.mockResolvedValueOnce({
        data: { success: true, data: mockBuyBox },
      });

      const result = await productsApi.getBuyBox('prod-100');

      expect(mockedGet).toHaveBeenCalledWith('/api/v1/products/prod-100/buybox');
      expect(result).toEqual(mockBuyBox);
      expect(result?.winnerOfferId).toBe('offer-1');
    });

    it('calls /api/v1/products/variants/:variantId/buybox when variant is specified', async () => {
      const mockBuyBox: BuyBoxResult = {
        productId: 'prod-100',
        variantId: 'var-99',
        winnerOfferId: 'offer-v1',
        sellerId: 'seller-xyz',
        price: 24.5,
        condition: 'REFURBISHED',
        currency: 'USD',
        isCalculated: true,
      };

      mockedGet.mockResolvedValueOnce({
        data: { success: true, data: mockBuyBox },
      });

      const result = await productsApi.getBuyBox('prod-100', 'var-99');

      expect(mockedGet).toHaveBeenCalledWith('/api/v1/products/variants/var-99/buybox');
      expect(result?.variantId).toBe('var-99');
    });

    it('returns null when buybox endpoint data is empty', async () => {
      mockedGet.mockResolvedValueOnce({
        data: { success: true, data: undefined },
      });

      const result = await productsApi.getBuyBox('prod-none');
      expect(result).toBeNull();
    });
  });
});
