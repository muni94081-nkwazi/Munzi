import { client } from './client';
import type { Role } from '../types/models';

export type SignupPayload = {
  email: string;
  password: string;
  role: Role;
  phone?: string;
  businessName?: string;
  category?: string;
  fullName?: string;
};

export const authApi = {
  signup: (payload: SignupPayload) => client.post('/auth/signup', payload).then((r) => r.data),
  login: (payload: { email: string; password: string }) => client.post('/auth/login', payload).then((r) => r.data),
  getMe: () => client.get('/auth/me').then((r) => r.data),
  requestPasswordReset: (email: string) => client.post('/auth/forgot-password', { email }).then((r) => r.data),
  changePassword: (payload: { oldPassword: string; newPassword: string }) =>
    client.patch('/auth/change-password', payload).then((r) => r.data),
};
