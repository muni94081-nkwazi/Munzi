import client from './client';

export const serviceApi = {
  /** GET /services?providerId=&category=&page=&limit= */
  list: (params) => client.get('/services', { params }).then((r) => r.data),

  /** GET /services/:id */
  get: (id) => client.get(`/services/${id}`).then((r) => r.data),

  /** POST /services - provider only */
  create: (payload) => client.post('/services', payload).then((r) => r.data),

  /** PATCH /services/:id - owning provider only */
  update: (id, payload) => client.patch(`/services/${id}`, payload).then((r) => r.data),

  /** DELETE /services/:id - owning provider only */
  remove: (id) => client.delete(`/services/${id}`).then((r) => r.data),
};
