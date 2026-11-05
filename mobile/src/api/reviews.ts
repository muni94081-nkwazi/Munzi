import { client, fetchWithCache } from './client';
import type { Review } from '../types/models';

export const reviewApi = {
  listForProvider: (providerId: string) =>
    fetchWithCache<Review[]>(`reviews:${providerId}`, () =>
      client.get(`/reviews/provider/${providerId}`).then((r) => r.data.data)
    ),
  create: (payload: { bookingId: string; rating: number; comment?: string }) =>
    client.post('/reviews', payload).then((r) => r.data),
};
