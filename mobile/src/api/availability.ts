import { client, fetchWithCache } from './client';
import type { AvailabilityWindow } from '../types/models';

export const availabilityApi = {
  listForProvider: (providerId: string) =>
    fetchWithCache<AvailabilityWindow[]>(`availability:${providerId}`, () =>
      client.get(`/availability/provider/${providerId}`).then((r) => r.data.data)
    ),
  listMine: () => client.get('/availability/me').then((r) => r.data),
  create: (payload: { dayOfWeek: number; startTime: string; endTime: string; isAvailable?: boolean }) =>
    client.post('/availability', payload).then((r) => r.data),
  update: (id: string, payload: Partial<AvailabilityWindow>) =>
    client.patch(`/availability/${id}`, payload).then((r) => r.data),
  remove: (id: string) => client.delete(`/availability/${id}`).then((r) => r.data),
};
