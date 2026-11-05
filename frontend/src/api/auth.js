import client from './client';

export const authApi = {
  /** POST /auth/signup - body includes role plus role-specific profile fields */
  signup: (payload) => client.post('/auth/signup', payload).then((r) => r.data),

  /** POST /auth/login */
  login: (payload) => client.post('/auth/login', payload).then((r) => r.data),

  /** GET /auth/me */
  getMe: () => client.get('/auth/me').then((r) => r.data),

  /** PATCH /auth/push-token - register (or clear with token: null) this browser's FCM token */
  registerPushToken: (token) => client.patch('/auth/push-token', { token }).then((r) => r.data),
};
