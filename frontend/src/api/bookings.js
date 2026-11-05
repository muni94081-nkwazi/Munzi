import client from './client';

export const bookingApi = {
  /** GET /bookings/me?status= */
  listMine: (params) => client.get('/bookings/me', { params }).then((r) => r.data),

  /** GET /bookings/:id */
  get: (id) => client.get(`/bookings/${id}`).then((r) => r.data),

  /** POST /bookings - customer only. { serviceId, bookingDate, startTime, notes } */
  create: (payload) => client.post('/bookings', payload).then((r) => r.data),

  /** PATCH /bookings/:id/status - { status } */
  updateStatus: (id, status) => client.patch(`/bookings/${id}/status`, { status }).then((r) => r.data),
};
