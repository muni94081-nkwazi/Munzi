import client from './client';

export const providerApi = {
  /** GET /providers?category=&page=&limit= - public directory */
  list: (params) => client.get('/providers', { params }).then((r) => r.data),

  /** GET /providers/:id - public profile */
  get: (id) => client.get(`/providers/${id}`).then((r) => r.data),

  /** PATCH /providers/me - update own provider profile */
  updateMe: (payload) => client.patch('/providers/me', payload).then((r) => r.data),
};

export const customerApi = {
  /** PATCH /customers/me - update own customer profile */
  updateMe: (payload) => client.patch('/customers/me', payload).then((r) => r.data),
};
