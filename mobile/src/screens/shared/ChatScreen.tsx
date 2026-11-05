import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useChat } from '../../context/ChatContext';
import { chatApi, Message } from '../../api/messages';
import { getSocket } from '../../api/socket';
import { spacing, radius } from '../../theme/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;

export default function ChatScreen({ route }: Props) {
  const { otherUserId, withName } = route.params;
  const { user } = useAuth();
  const { colors } = useTheme();
  const { onlineStatus, refreshChats } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const isOnline = onlineStatus[otherUserId] ?? false;

  const loadMessages = useCallback(async () => {
    try {
      const res = await chatApi.getMessages(otherUserId, { limit: 50 });
      setMessages(res.data || []);
      // Mark messages as read
      chatApi.markRead(otherUserId).catch(() => {});
    } catch {
      // Silent fail
    }
  }, [otherUserId]);

  useEffect(() => {
    loadMessages();

    const socket = getSocket();
    if (!socket) return;

    // Join the conversation room for typing indicators
    socket.emit('join_room', { otherUserId });

    const handleNewMessage = (msg: Message) => {
      // Only add if this message belongs to our conversation
      if (msg.sender_id === otherUserId || msg.receiver_id === otherUserId) {
        setMessages((prev) => [...prev, msg]);
        // Mark as read since we're viewing the chat
        chatApi.markRead(otherUserId).catch(() => {});
        // Also emit socket read event
        socket.emit('mark_read', { otherUserId });
      }
    };

    const handleTyping = ({ userId, isTyping }: { userId: string; isTyping: boolean }) => {
      if (userId === otherUserId) setTyping(isTyping);
    };

    const handleMessagesRead = () => {
      setMessages((prev) => prev.map((m) => (m.sender_id === user?.id ? { ...m, read: true } : m)));
    };

    socket.on('new_message', handleNewMessage);
    socket.on('typing', handleTyping);
    socket.on('messages_read', handleMessagesRead);

    return () => {
      socket.emit('leave_room', { otherUserId });
      socket.off('new_message', handleNewMessage);
      socket.off('typing', handleTyping);
      socket.off('messages_read', handleMessagesRead);
      refreshChats();
    };
  }, [otherUserId, loadMessages, user?.id, refreshChats]);

  const handleSend = () => {
    if (!text.trim() || !user) return;
    const socket = getSocket();
    if (socket) {
      socket.emit('send_message', {
        receiverId: otherUserId,
        message: text.trim(),
      });
    }
    setText('');
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleTextChange = (value: string) => {
    setText(value);
    const socket = getSocket();
    if (socket) {
      socket.emit('typing', { receiverId: otherUserId, isTyping: true });
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('typing', { receiverId: otherUserId, isTyping: false });
      }, 2000);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <View style={{ padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>{withName}</Text>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isOnline ? '#22c55e' : colors.slate }} />
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg }}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <Text style={{ color: colors.slate, textAlign: 'center', marginTop: spacing.xl }}>
            Say hello to start the conversation.
          </Text>
        }
        renderItem={({ item }) => {
          const isMine = item.sender_id === user?.id;
          return (
            <View
              style={{
                alignSelf: isMine ? 'flex-end' : 'flex-start',
                backgroundColor: isMine ? colors.marigold : colors.surface,
                borderColor: colors.border,
                borderWidth: isMine ? 0 : 1,
                borderRadius: radius.md,
                paddingHorizontal: spacing.md,
                paddingVertical: spacing.sm,
                marginBottom: spacing.sm,
                maxWidth: '78%',
              }}
            >
              <Text style={{ color: colors.ink }}>{item.message}</Text>
              {isMine && (
                <Text style={{ color: isMine ? colors.ink + '80' : colors.slate, fontSize: 10, textAlign: 'right', marginTop: 2 }}>
                  {item.read ? '✓✓' : '✓'}
                </Text>
              )}
            </View>
          );
        }}
      />

      {typing && (
        <Text style={{ paddingHorizontal: spacing.lg, color: colors.slate, fontSize: 12, fontStyle: 'italic' }}>
          {withName} is typing…
        </Text>
      )}

      <View
        style={{
          flexDirection: 'row',
          padding: spacing.md,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          gap: spacing.sm,
        }}
      >
        <TextInput
          value={text}
          onChangeText={handleTextChange}
          placeholder="Type a message…"
          placeholderTextColor={colors.slate}
          style={{
            flex: 1,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 999,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            color: colors.ink,
            backgroundColor: colors.surface,
          }}
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          onPress={handleSend}
          style={{ backgroundColor: colors.marigold, borderRadius: 999, paddingHorizontal: spacing.lg, justifyContent: 'center' }}
        >
          <Text style={{ color: colors.ink, fontWeight: '700' }}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
