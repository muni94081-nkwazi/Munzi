import client from './client';

export const availabilityApi = {
  /** GET /availability/provider/:providerId - public */
  listForProvider: (providerId) =>
    client.get(`/availability/provider/${providerId}`).then((r) => r.data),

  /** GET /availability/me - provider only */
  listMine: () => client.get('/availability/me').then((r) => r.data),

  /** POST /availability - provider only. { dayOfWeek, startTime, endTime, isAvailable } */
  create: (payload) => client.post('/availability', payload).then((r) => r.data),

  /** PATCH /availability/:id */
  update: (id, payload) => client.patch(`/availability/${id}`, payload).then((r) => r.data),

  /** DELETE /availability/:id */
  remove: (id) => client.delete(`/availability/${id}`).then((r) => r.data),
};
