import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { chatApi, Conversation } from '../api/messages';
import { connectSocket, disconnectSocket, getSocket } from '../api/socket';

type OnlineMap = Record<string, boolean>;

type ChatCtx = {
  conversations: Conversation[];
  totalUnread: number;
  onlineStatus: OnlineMap;
  connected: boolean;
  refreshChats: () => Promise<void>;
};

const ChatContext = createContext<ChatCtx>({
  conversations: [],
  totalUnread: 0,
  onlineStatus: {},
  connected: false,
  refreshChats: async () => {},
});

export function useChat() {
  return useContext(ChatContext);
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState<OnlineMap>({});
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const refreshChats = useCallback(async () => {
    try {
      const { data } = await chatApi.listChats();
      setConversations(data);
      const unread = data.reduce((sum: number, c: Conversation) => sum + c.unread_count, 0);
      setTotalUnread(unread);
    } catch {
      // Silently fail - cached data may be shown
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      setConnected(false);
      setConversations([]);
      setTotalUnread(0);
      return;
    }

    let mounted = true;

    (async () => {
      try {
        const sock = await connectSocket();
        socketRef.current = sock;

        sock.on('connect', () => mounted && setConnected(true));
        sock.on('disconnect', () => mounted && setConnected(false));

        sock.on('new_message', () => {
          if (mounted) refreshChats();
        });

        sock.on('messages_read', () => {
          if (mounted) refreshChats();
        });

        sock.on('presence', ({ userId, online }: { userId: string; online: boolean }) => {
          if (mounted) {
            setOnlineStatus((prev) => ({ ...prev, [userId]: online }));
          }
        });

        await refreshChats();
      } catch {
        // Socket connection failed - chat will work via REST only
      }
    })();

    return () => {
      mounted = false;
      disconnectSocket();
    };
  }, [isAuthenticated, refreshChats]);

  return (
    <ChatContext.Provider value={{ conversations, totalUnread, onlineStatus, connected, refreshChats }}>
      {children}
    </ChatContext.Provider>
  );
}
