import { client, fetchWithCache } from './client';
import type { Service } from '../types/models';

export const serviceApi = {
  list: (params?: { providerId?: string; category?: string }) =>
    fetchWithCache<Service[]>(`services:${JSON.stringify(params ?? {})}`, () =>
      client.get('/services', { params }).then((r) => r.data.data)
    ),
  get: (id: string) => client.get(`/services/${id}`).then((r) => r.data),
  create: (payload: { title: string; description?: string; category?: string; price: number; durationMinutes: number }) =>
    client.post('/services', payload).then((r) => r.data),
  update: (id: string, payload: Partial<Service>) => client.patch(`/services/${id}`, payload).then((r) => r.data),
  remove: (id: string) => client.delete(`/services/${id}`).then((r) => r.data),
};
