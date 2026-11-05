import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { Card, StarRating, Input, Button, LoadingView, ErrorView, EmptyState } from '../../components/ui';
import { reviewApi } from '../../api/reviews';
import { formatDate } from '../../utils/formatters';
import { spacing } from '../../theme/theme';
import type { Review } from '../../types/models';

type Props = NativeStackScreenProps<RootStackParamList, 'Reviews'>;

export default function ReviewsScreen({ route, navigation }: Props) {
  const { providerId, providerName, bookingToReview } = route.params;
  const { colors } = useTheme();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await reviewApi.listForProvider(providerId);
      setReviews(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [providerId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async () => {
    if (!bookingToReview) return;
    setSubmitting(true);
    try {
      await reviewApi.create({ bookingId: bookingToReview.id, rating, comment });
      setSubmitted(true);
      load();
      setTimeout(() => navigation.goBack(), 900);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Text style={{ fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: spacing.md }}>{providerName} — Reviews</Text>

      {bookingToReview && !submitted && (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: spacing.sm }}>Leave a review</Text>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: spacing.sm }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity key={n} onPress={() => setRating(n)}>
                <Text style={{ fontSize: 26, color: n <= rating ? colors.marigold : colors.border }}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Input placeholder="How was your experience?" multiline numberOfLines={3} value={comment} onChangeText={setComment} />
          <Button title={submitting ? 'Submitting…' : 'Submit review'} onPress={handleSubmit} loading={submitting} />
        </Card>
      )}
      {submitted && <Text style={{ color: colors.forest, fontWeight: '600', marginBottom: spacing.lg }}>Thanks for your review!</Text>}

      {loading && <LoadingView label="Loading reviews…" />}
      {!loading && error && <ErrorView message={error} onRetry={load} />}
      {!loading && !error && (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          ListEmptyComponent={<EmptyState title="No reviews yet" />}
          renderItem={({ item }) => (
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 13 }}>{item.customer_name}</Text>
                <StarRating rating={item.rating} showValue={false} />
              </View>
              {item.comment && <Text style={{ color: colors.slate, fontSize: 12, marginTop: 4 }}>{item.comment}</Text>}
              <Text style={{ color: colors.slate, fontSize: 10, marginTop: 4 }}>{formatDate(item.created_at)}</Text>
            </Card>
          )}
        />
      )}
    </View>
  );
}
