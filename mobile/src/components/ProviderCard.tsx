import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { StarRating } from './ui';
import { formatCurrency } from '../utils/formatters';
import type { ProviderProfile } from '../types/models';
import { spacing, radius } from '../theme/theme';

export function ProviderCard({ provider, onPress }: { provider: ProviderProfile; onPress: () => void }) {
  const { colors } = useTheme();
  const seed = encodeURIComponent(provider.business_name || 'Provider');

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderTopColor: colors.marigold }]}
    >
      <Image source={{ uri: provider.imageUrl || `https://api.dicebear.com/7.x/initials/svg?seed=${seed}` }} style={styles.image} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>
            {provider.business_name}
          </Text>
          {provider.is_verified && <Text style={{ color: colors.forest, fontSize: 11, fontWeight: '700' }}>✓</Text>}
        </View>
        <Text style={{ color: colors.slate, fontSize: 12, textTransform: 'capitalize' }}>{provider.category}</Text>
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <StarRating rating={provider.rating || 0} />
          {provider.location && <Text style={{ color: colors.slate, fontSize: 11 }}>📍 {provider.location}</Text>}
        </View>
        {!!provider.hourly_rate && (
          <Text style={{ color: colors.ink, fontWeight: '700', marginTop: 6, fontSize: 13 }}>
            From {formatCurrency(provider.hourly_rate)}/hr
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderTopWidth: 3,
    marginBottom: spacing.md,
  },
  image: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: '#ccc' },
  name: { fontWeight: '700', fontSize: 15, flexShrink: 1 },
});
