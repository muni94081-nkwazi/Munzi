import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { Card, StatusBadge, LoadingView, ErrorView, EmptyState, OfflineBanner } from '../../components/ui';
import { bookingApi } from '../../api/bookings';
import { formatCurrency, formatDate, formatTime } from '../../utils/formatters';
import { spacing } from '../../theme/theme';
import type { Booking, BookingStatus } from '../../types/models';

const FILTERS: (BookingStatus | 'all')[] = ['all', 'pending', 'confirmed', 'completed', 'cancelled'];

export default function ProviderBookingsScreen() {
  const { colors } = useTheme();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

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

  const handleAction = async (booking: Booking, status: BookingStatus) => {
    try {
      await bookingApi.updateStatus(booking.id, status);
      load();
    } catch {
      // Errors surface via the shared ErrorView on next load; this keeps the row action simple.
    }
  };

  const filtered = useMemo(() => (filter === 'all' ? bookings : bookings.filter((b) => b.status === filter)), [bookings, filter]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ padding: spacing.lg, paddingBottom: 0 }}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => setFilter(f)}
            style={{
              backgroundColor: filter === f ? colors.ink : colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 999,
              paddingHorizontal: 14,
              paddingVertical: 8,
              marginRight: 8,
            }}
          >
            <Text style={{ color: filter === f ? colors.white : colors.ink, fontSize: 12, fontWeight: '700', textTransform: 'capitalize' }}>
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {loading && <LoadingView label="Loading bookings…" />}
      {!loading && error && (
        <View style={{ padding: spacing.lg }}>
          <ErrorView message={error} onRetry={load} />
        </View>
      )}
      {!loading && !error && (
        <FlatList
          data={filtered}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={<EmptyState title="No bookings" description="Nothing matches this filter yet." />}
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.ink, fontWeight: '700' }}>{item.service_title}</Text>
                  <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>Customer: {item.customer_name}</Text>
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
              <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                {item.status === 'pending' && (
                  <TouchableOpacity onPress={() => handleAction(item, 'confirmed')}>
                    <Text style={{ color: colors.forest, fontWeight: '700', fontSize: 13 }}>Confirm</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'confirmed' && (
                  <TouchableOpacity onPress={() => handleAction(item, 'completed')}>
                    <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13 }}>Mark completed</Text>
                  </TouchableOpacity>
                )}
                {['pending', 'confirmed'].includes(item.status) && (
                  <TouchableOpacity onPress={() => handleAction(item, 'cancelled')}>
                    <Text style={{ color: colors.clay, fontWeight: '700', fontSize: 13 }}>Cancel</Text>
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
