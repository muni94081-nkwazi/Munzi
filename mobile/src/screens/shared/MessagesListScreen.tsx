import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { useChat } from '../../context/ChatContext';
import { EmptyState } from '../../components/ui';
import { spacing, radius } from '../../theme/theme';

export default function MessagesListScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { conversations, onlineStatus, refreshChats } = useChat();
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      refreshChats();
    }, [refreshChats])
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshChats();
    setRefreshing(false);
  };

  if (conversations.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState message="No conversations yet. Start chatting by booking a service!" />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.md }}
      data={conversations}
      keyExtractor={(item) => item.other_user_id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.marigold} />}
      renderItem={({ item }) => {
        const isOnline = onlineStatus[item.other_user_id] ?? false;
        const time = item.last_message_at
          ? new Date(item.last_message_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        return (
          <TouchableOpacity
            onPress={() =>
              navigation.navigate('Chat', {
                otherUserId: item.other_user_id,
                withName: item.other_user_name || item.other_user_email,
              })
            }
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              padding: spacing.md,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              marginBottom: spacing.sm,
            }}
          >
            {/* Avatar circle */}
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: colors.marigold + '30', justifyContent: 'center', alignItems: 'center', marginRight: spacing.md }}>
              <Text style={{ fontSize: 18 }}>{(item.other_user_name || '?')[0].toUpperCase()}</Text>
            </View>

            {/* Content */}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>
                    {item.other_user_name || item.other_user_email}
                  </Text>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isOnline ? '#22c55e' : 'transparent' }} />
                </View>
                <Text style={{ color: colors.slate, fontSize: 11 }}>{time}</Text>
              </View>
              <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                {item.last_message}
              </Text>
            </View>

            {/* Unread badge */}
            {item.unread_count > 0 && (
              <View style={{ backgroundColor: colors.marigold, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', marginLeft: spacing.sm, paddingHorizontal: 6 }}>
                <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '700' }}>{item.unread_count}</Text>
              </View>
            )}
          </TouchableOpacity>
        );
      }}
    />
  );
}
