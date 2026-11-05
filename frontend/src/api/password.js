import client from './client';

export const passwordApi = {
  /** PATCH /auth/change-password */
  changePassword: ({ oldPassword, newPassword }) =>
    client.patch('/auth/change-password', { oldPassword, newPassword }).then((r) => r.data),

  /** POST /auth/forgot-password */
  forgotPassword: (email) =>
    client.post('/auth/forgot-password', { email }).then((r) => r.data),

  /** POST /auth/reset-password */
  resetPassword: ({ token, newPassword }) =>
    client.post('/auth/reset-password', { token, newPassword }).then((r) => r.data),
};
