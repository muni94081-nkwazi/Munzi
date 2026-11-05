import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { Card, StarRating, LoadingView, ErrorView, EmptyState, Button } from '../../components/ui';
import { providerApi } from '../../api/providers';
import { serviceApi } from '../../api/services';
import { availabilityApi } from '../../api/availability';
import { reviewApi } from '../../api/reviews';
import { DAYS_OF_WEEK } from '../../utils/constants';
import { formatCurrency, formatDuration, formatDate } from '../../utils/formatters';
import { spacing } from '../../theme/theme';
import type { ProviderProfile, Service, AvailabilityWindow, Review } from '../../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'ProviderDetail'>;

export default function ProviderDetailScreen({ route, navigation }: Props) {
  const { providerId } = route.params;
  const { colors } = useTheme();

  const [provider, setProvider] = useState<ProviderProfile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [p, s, a, r] = await Promise.all([
        providerApi.get(providerId),
        serviceApi.list({ providerId }),
        availabilityApi.listForProvider(providerId),
        reviewApi.listForProvider(providerId),
      ]);
      setProvider(p.data);
      setServices(s.data);
      setAvailability(a.data);
      setReviews(r.data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingView label="Loading provider…" />;
  if (error || !provider) {
    return (
      <View style={{ padding: spacing.lg }}>
        <ErrorView message={error || 'Provider not found.'} onRetry={load} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        <Image
          source={{ uri: provider.imageUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(provider.business_name)}` }}
          style={{ width: 88, height: 88, borderRadius: 12, backgroundColor: colors.surface }}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 19, fontWeight: '700', color: colors.ink }}>{provider.business_name}</Text>
          <Text style={{ color: colors.slate, textTransform: 'capitalize' }}>{provider.category}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
            <StarRating rating={provider.rating || 0} />
            <Text style={{ color: colors.slate, fontSize: 12 }}>({reviews.length} reviews)</Text>
          </View>
          {provider.location && <Text style={{ color: colors.slate, fontSize: 12, marginTop: 4 }}>📍 {provider.location}</Text>}
        </View>
      </View>

      {provider.description && <Text style={{ color: colors.ink, marginTop: spacing.md, fontSize: 13 }}>{provider.description}</Text>}

      <SectionHeader title="Services" colors={colors} />
      {services.length === 0 ? (
        <EmptyState title="No services listed yet" />
      ) : (
        services.map((s) => (
          <Card key={s.id} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontWeight: '600' }}>{s.title}</Text>
                <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>{formatDuration(s.duration_minutes)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: colors.ink, fontWeight: '700' }}>{formatCurrency(s.price)}</Text>
                <TouchableOpacity
                  onPress={() => navigation.navigate('BookingFlow', { service: s, provider })}
                  style={{ backgroundColor: colors.marigold, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginTop: 6 }}
                >
                  <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 12 }}>Book now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Card>
        ))
      )}

      <SectionHeader title="Weekly availability" colors={colors} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {DAYS_OF_WEEK.map((day) => {
          const dayWindows = availability.filter((a) => a.day_of_week === day.value && a.is_available);
          return (
            <View
              key={day.value}
              style={{
                flexBasis: '22%',
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 8,
                padding: spacing.sm,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.ink, fontSize: 11, fontWeight: '700' }}>{day.short}</Text>
              {dayWindows.length === 0 ? (
                <Text style={{ color: colors.slate, fontSize: 10, marginTop: 2 }}>Closed</Text>
              ) : (
                dayWindows.map((w) => (
                  <Text key={w.id} style={{ color: colors.slate, fontSize: 10, marginTop: 2 }}>
                    {w.start_time.slice(0, 5)}–{w.end_time.slice(0, 5)}
                  </Text>
                ))
              )}
            </View>
          );
        })}
      </View>

      <SectionHeader title="Reviews" colors={colors} />
      <TouchableOpacity onPress={() => navigation.navigate('Reviews', { providerId, providerName: provider.business_name })}>
        <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 13, marginBottom: spacing.sm }}>See all reviews →</Text>
      </TouchableOpacity>
      {reviews.length === 0 ? (
        <EmptyState title="No reviews yet" description="Be the first to book and leave a review." />
      ) : (
        reviews.slice(0, 3).map((r) => (
          <Card key={r.id} style={{ marginBottom: spacing.sm }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>{r.customer_name}</Text>
              <StarRating rating={r.rating} showValue={false} />
            </View>
            {r.comment && <Text style={{ color: colors.slate, fontSize: 12, marginTop: 4 }}>{r.comment}</Text>}
            <Text style={{ color: colors.slate, fontSize: 10, marginTop: 4 }}>{formatDate(r.created_at)}</Text>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

function SectionHeader({ title, colors }: { title: string; colors: ReturnType<typeof useTheme>['colors'] }) {
  return <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink, marginTop: spacing.lg, marginBottom: spacing.sm }}>{title}</Text>;
}
