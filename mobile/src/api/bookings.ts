import { client, fetchWithCache } from './client';
import type { Booking, BookingStatus } from '../types/models';

export const bookingApi = {
  listMine: (params?: { status?: BookingStatus }) =>
    fetchWithCache<Booking[]>(`bookings:${JSON.stringify(params ?? {})}`, () =>
      client.get('/bookings/me', { params }).then((r) => r.data.data)
    ),
  get: (id: string) => client.get(`/bookings/${id}`).then((r) => r.data),
  create: (payload: { serviceId: string; bookingDate: string; startTime: string; notes?: string }) =>
    client.post('/bookings', payload).then((r) => r.data),
  updateStatus: (id: string, status: BookingStatus) =>
    client.patch(`/bookings/${id}/status`, { status }).then((r) => r.data),
};
