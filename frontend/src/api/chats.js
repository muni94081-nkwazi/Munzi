import client from './client';

export const chatApi = {
  /** GET /chats - all conversations, each with last message + unread count */
  listChats: () => client.get('/chats').then((r) => r.data),

  /** GET /chats/:otherUserId/messages?before=&limit= */
  getMessages: (otherUserId, params) => client.get(`/chats/${otherUserId}/messages`, { params }).then((r) => r.data),

  /** PATCH /chats/:otherUserId/read */
  markRead: (otherUserId) => client.patch(`/chats/${otherUserId}/read`).then((r) => r.data),

  /** GET /chats/unread-count */
  getUnreadCount: () => client.get('/chats/unread-count').then((r) => r.data),

  /** GET /chats/:otherUserId/online */
  getOnlineStatus: (otherUserId) => client.get(`/chats/${otherUserId}/online`).then((r) => r.data),
};
