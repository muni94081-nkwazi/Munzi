import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProviderTabParamList, RootStackParamList } from '../../types/navigation';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Card, StatusBadge, LoadingView, ErrorView, EmptyState, OfflineBanner } from '../../components/ui';
import { bookingApi } from '../../api/bookings';
import { formatCurrency, formatDate, formatTime } from '../../utils/formatters';
import { spacing, radius } from '../../theme/theme';
import type { Booking, ProviderProfile } from '../../types/models';

type Props = CompositeScreenProps<
  BottomTabScreenProps<ProviderTabParamList, 'Dashboard'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function ProviderDashboardScreen({ navigation }: Props) {
  const { profile } = useAuth();
  const providerProfile = profile as ProviderProfile | null;
  const { colors } = useTheme();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  const stats = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().getMonth();
    return {
      today: bookings.filter((b) => b.booking_date?.slice(0, 10) === todayKey).length,
      requests: bookings.filter((b) => b.status === 'pending').length,
      earnings: bookings
        .filter((b) => b.status === 'completed' && new Date(b.booking_date).getMonth() === thisMonth)
        .reduce((sum, b) => sum + Number(b.service_price || 0), 0),
    };
  }, [bookings]);

  const upcoming = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bookings
      .filter((b) => ['pending', 'confirmed'].includes(b.status) && new Date(b.booking_date) >= today)
      .sort((a, b) => new Date(a.booking_date).getTime() - new Date(b.booking_date).getTime())
      .slice(0, 6);
  }, [bookings]);

  return (
    <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <OfflineBanner />
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>
        Welcome back{providerProfile?.business_name ? `, ${providerProfile.business_name}` : ''}
      </Text>

      {loading && <LoadingView label="Loading your dashboard…" />}
      {!loading && error && <ErrorView message={error} onRetry={load} />}

      {!loading && !error && (
        <>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg }}>
            <StatBox label="Today's bookings" value={String(stats.today)} />
            <StatBox label="New requests" value={String(stats.requests)} />
            <StatBox label="Earnings this month" value={formatCurrency(stats.earnings)} />
            <StatBox label="Rating" value={providerProfile?.rating ? Number(providerProfile.rating).toFixed(1) : '—'} />
          </View>

          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, flexWrap: 'wrap' }}>
            <QuickAction label="View calendar" onPress={() => navigation.navigate('Calendar')} colors={colors} />
            <QuickAction label="Add service" onPress={() => navigation.navigate('ProviderProfile')} colors={colors} />
            <QuickAction label="View all bookings" onPress={() => navigation.navigate('ProviderBookings')} colors={colors} />
          </View>

          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: spacing.xl, marginBottom: spacing.md }}>
            Upcoming bookings
          </Text>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming bookings" description="New requests will show up here." />
          ) : (
            upcoming.map((b) => (
              <Card key={b.id} style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontWeight: '700' }}>{b.service_title}</Text>
                    <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>Customer: {b.customer_name}</Text>
                    <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>
                      {formatDate(b.booking_date)} · {formatTime(b.start_time)}
                    </Text>
                  </View>
                  <StatusBadge status={b.status} />
                </View>
              </Card>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexBasis: '48%',
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderTopWidth: 3,
        borderTopColor: colors.marigold,
        borderRadius: radius.md,
        padding: spacing.md,
      }}
    >
      <Text style={{ color: colors.slate, fontSize: 11, textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: 20, fontWeight: '700', marginTop: 4 }}>{value}</Text>
    </View>
  );
}

function QuickAction({ label, onPress, colors }: { label: string; onPress: () => void; colors: ReturnType<typeof useTheme>['colors'] }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ borderColor: colors.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9 }}
    >
      <Text style={{ color: colors.ink, fontSize: 12, fontWeight: '600' }}>{label}</Text>
    </TouchableOpacity>
  );
}
