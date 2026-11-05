import { client, fetchWithCache } from './client';

export type Conversation = {
  other_user_id: string;
  other_user_name: string;
  other_user_email: string;
  other_user_role: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
};

export type Message = {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  attachment_url?: string;
  read: boolean;
  created_at: string;
};

export const chatApi = {
  listChats: () =>
    fetchWithCache<Conversation[]>('chats', () =>
      client.get('/chats').then((r) => r.data.data)
    ),
  getMessages: (otherUserId: string, params?: { before?: string; limit?: number }) =>
    client.get(`/chats/${otherUserId}/messages`, { params }).then((r) => r.data),
  markRead: (otherUserId: string) =>
    client.patch(`/chats/${otherUserId}/read`).then((r) => r.data),
  getUnreadCount: () =>
    client.get('/chats/unread-count').then((r) => r.data),
  getOnlineStatus: (otherUserId: string) =>
    client.get(`/chats/${otherUserId}/online`).then((r) => r.data),
};
