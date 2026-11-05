import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CustomerTabParamList, RootStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { Card, StatusBadge, LoadingView, ErrorView, EmptyState, OfflineBanner, Button } from '../../components/ui';
import { bookingApi } from '../../api/bookings';
import { formatDate, formatTime, formatCurrency } from '../../utils/formatters';
import { spacing } from '../../theme/theme';
import type { Booking } from '../../types/models';

type Props = CompositeScreenProps<
  BottomTabScreenProps<CustomerTabParamList, 'Bookings'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function CustomerBookingsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await bookingApi.listMine();
      setBookings(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const grouped = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const upcoming = bookings.filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.booking_date) >= today);
    const past = bookings.filter(
      (b) => b.status === 'completed' || b.status === 'cancelled' || new Date(b.booking_date) < today
    );
    return { upcoming, past };
  }, [bookings]);

  const list = grouped[tab];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <View style={{ flexDirection: 'row', paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
        {(['upcoming', 'past'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={{
              paddingBottom: 8,
              borderBottomWidth: 2,
              borderBottomColor: tab === t ? colors.marigold : 'transparent',
            }}
          >
            <Text style={{ color: tab === t ? colors.ink : colors.slate, fontWeight: '700', textTransform: 'capitalize' }}>
              {t} ({grouped[t].length})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && <LoadingView label="Loading your bookings…" />}
      {!loading && error && (
        <View style={{ padding: spacing.lg }}>
          <ErrorView message={error} onRetry={load} />
        </View>
      )}
      {!loading && !error && (
        <FlatList
          data={list}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={<EmptyState title={`No ${tab} bookings`} description="They'll show up here." />}
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>{item.service_title}</Text>
                  <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>Provider: {item.provider_name}</Text>
                  <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>
                    {formatDate(item.booking_date)} · {formatTime(item.start_time)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <StatusBadge status={item.status} />
                  {!!item.service_price && (
                    <Text style={{ color: colors.ink, fontWeight: '700', marginTop: 6 }}>{formatCurrency(item.service_price)}</Text>
                  )}
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                {item.status === 'completed' && (
                  <TouchableOpacity
                    onPress={() =>
                      navigation.navigate('Reviews', {
                        providerId: item.provider_id,
                        providerName: item.provider_name || 'Provider',
                        bookingToReview: item,
                      })
                    }
                  >
                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>Leave a review</Text>
                  </TouchableOpacity>
                )}
                {['pending', 'confirmed'].includes(item.status) && (
                  <TouchableOpacity onPress={() => navigation.navigate('Chat', { conversationId: item.id, withName: item.provider_name || 'Provider' })}>
                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>Message provider</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Card>
          )}
        />
      )}
    </View>
  );
}
