import client from './client';

export const reviewApi = {
  /** GET /reviews/provider/:providerId - public */
  listForProvider: (providerId, params) =>
    client.get(`/reviews/provider/${providerId}`, { params }).then((r) => r.data),

  /** POST /reviews - customer only. { bookingId, rating, comment } */
  create: (payload) => client.post('/reviews', payload).then((r) => r.data),
};
