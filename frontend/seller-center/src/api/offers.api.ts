import axiosInstance from './axios.config';
import type {
  ProductOffer,
  CreateOfferInput,
  UpdateOfferInput,
  ListOffersQuery,
  PaginatedOffers,
} from '../types/offer.types';

export const offersApi = {
  create: async (payload: CreateOfferInput): Promise<ProductOffer> => {
    const { data } = await axiosInstance.post('/seller/offers', payload);
    return data.data;
  },

  listMyOffers: async (query?: ListOffersQuery): Promise<PaginatedOffers> => {
    const { data } = await axiosInstance.get('/seller/offers', { params: query });
    return {
      total: data.total ?? 0,
      page: data.page ?? 1,
      limit: data.limit ?? 20,
      totalPages: data.totalPages ?? 1,
      offers: data.offers ?? [],
    };
  },

  getById: async (id: string): Promise<ProductOffer> => {
    const { data } = await axiosInstance.get(`/seller/offers/${id}`);
    return data.data;
  },

  update: async (id: string, payload: UpdateOfferInput): Promise<ProductOffer> => {
    const { data } = await axiosInstance.put(`/seller/offers/${id}`, payload);
    return data.data;
  },

  delete: async (id: string): Promise<{ success: boolean; message?: string }> => {
    const { data } = await axiosInstance.delete(`/seller/offers/${id}`);
    return data;
  },

  /** Search the public canonical catalogue to list a competing offer against an existing product */
  searchCatalog: async (query: string): Promise<any[]> => {
    const { data } = await axiosInstance.get('/products', {
      params: { q: query, search: query, limit: 10 },
    });
    return data.products ?? data.data ?? [];
  },

  /** Get canonical variants for a selected product */
  getProductVariants: async (productId: string): Promise<any[]> => {
    const { data } = await axiosInstance.get(`/products/${productId}/variants`);
    return data.data ?? data.variants ?? [];
  },
};
