import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { connectSocket, disconnectSocket } from '../socket';
import { chatApi } from '../api/chats';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { isAuthenticated, user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [onlineStatus, setOnlineStatus] = useState({}); // { [userId]: boolean }
  const [connected, setConnected] = useState(false);
  const socketRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await chatApi.listChats();
      setConversations(data);
      setTotalUnread(data.reduce((sum, c) => sum + (c.unread_count || 0), 0));
    } catch {
      // Chat list is a nice-to-have on most pages - fail silently here;
      // the dedicated Messages page shows its own real error state.
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      socketRef.current = null;
      setConnected(false);
      setConversations([]);
      setTotalUnread(0);
      return;
    }

    const token = localStorage.getItem('bulk_token');
    const socket = connectSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    // Any message involving me, anywhere in the app, updates the global
    // list + badge. The Messages page adds its own listener too for
    // rendering the open conversation - both fire independently off the
    // same event, no duplicate network activity.
    socket.on('new_message', () => {
      loadConversations();
    });
    socket.on('messages_read', () => {
      loadConversations();
    });
    socket.on('presence', ({ userId, online }) => {
      setOnlineStatus((prev) => ({ ...prev, [userId]: online }));
    });

    loadConversations();

    return () => {
      socket.off('new_message');
      socket.off('messages_read');
      socket.off('presence');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, [isAuthenticated, user?.id, loadConversations]);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        totalUnread,
        onlineStatus,
        connected,
        refreshConversations: loadConversations,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
