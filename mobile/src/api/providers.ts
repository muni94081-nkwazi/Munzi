import { client, fetchWithCache } from './client';
import type { ProviderProfile } from '../types/models';

export const providerApi = {
  list: (params?: { category?: string; page?: number; limit?: number }) =>
    fetchWithCache<ProviderProfile[]>(`providers:${JSON.stringify(params ?? {})}`, () =>
      client.get('/providers', { params }).then((r) => r.data.data)
    ),
  get: (id: string) =>
    fetchWithCache<ProviderProfile>(`provider:${id}`, () => client.get(`/providers/${id}`).then((r) => r.data.data)),
  updateMe: (payload: Partial<ProviderProfile>) => client.patch('/providers/me', payload).then((r) => r.data),
};

export const customerApi = {
  updateMe: (payload: { address?: string; preferredContact?: string }) =>
    client.patch('/customers/me', payload).then((r) => r.data),
};
