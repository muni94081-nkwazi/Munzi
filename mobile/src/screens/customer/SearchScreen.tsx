import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { CustomerTabParamList, RootStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { ProviderCard } from '../../components/ProviderCard';
import { LoadingView, ErrorView, EmptyState, OfflineBanner } from '../../components/ui';
import { providerApi } from '../../api/providers';
import { CATEGORIES } from '../../utils/constants';
import { spacing, radius } from '../../theme/theme';
import type { ProviderProfile } from '../../types/models';

type Props = CompositeScreenProps<
  BottomTabScreenProps<CustomerTabParamList, 'Search'>,
  NativeStackScreenProps<RootStackParamList>
>;

const SORT_OPTIONS = [
  { value: 'rating', label: 'Top rated' },
  { value: 'price_low', label: 'Price: low' },
  { value: 'price_high', label: 'Price: high' },
] as const;

export default function SearchScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const [category, setCategory] = useState<string | undefined>(route.params?.category);
  const [query, setQuery] = useState(route.params?.query ?? '');
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]['value']>('rating');
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await providerApi.list({ category, limit: 50 });
      setProviders(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    load();
  }, [load]);

  const results = useMemo(() => {
    let list = [...providers];
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((p) => p.business_name?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q));
    }
    switch (sortBy) {
      case 'price_low':
        list.sort((a, b) => (a.hourly_rate || 0) - (b.hourly_rate || 0));
        break;
      case 'price_high':
        list.sort((a, b) => (b.hourly_rate || 0) - (a.hourly_rate || 0));
        break;
      default:
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    return list;
  }, [providers, query, sortBy]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <OfflineBanner />
      <View style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <TextInput
          placeholder="Search…"
          placeholderTextColor={colors.slate}
          value={query}
          onChangeText={setQuery}
          style={{
            backgroundColor: colors.surface,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: radius.md,
            paddingHorizontal: spacing.md,
            paddingVertical: 10,
            color: colors.ink,
            marginBottom: spacing.md,
          }}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
          <TouchableOpacity
            onPress={() => setCategory(undefined)}
            style={[
              chipStyle(colors, !category),
            ]}
          >
            <Text style={{ color: !category ? colors.white : colors.ink, fontSize: 12, fontWeight: '600' }}>All</Text>
          </TouchableOpacity>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c.value} onPress={() => setCategory(c.value)} style={chipStyle(colors, category === c.value)}>
              <Text style={{ color: category === c.value ? colors.white : colors.ink, fontSize: 12, fontWeight: '600' }}>
                {c.emoji} {c.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {SORT_OPTIONS.map((o) => (
            <TouchableOpacity key={o.value} onPress={() => setSortBy(o.value)} style={chipStyle(colors, sortBy === o.value)}>
              <Text style={{ color: sortBy === o.value ? colors.white : colors.ink, fontSize: 12, fontWeight: '600' }}>
                Sort: {o.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading && <LoadingView label="Searching…" />}
      {!loading && error && (
        <View style={{ padding: spacing.lg }}>
          <ErrorView message={error} onRetry={load} />
        </View>
      )}
      {!loading && !error && (
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 0 }}
          ListEmptyComponent={<EmptyState title="No providers found" description="Try a different category or search term." />}
          renderItem={({ item }) => (
            <ProviderCard provider={item} onPress={() => navigation.navigate('ProviderDetail', { providerId: item.id })} />
          )}
        />
      )}
    </View>
  );
}

function chipStyle(colors: ReturnType<typeof useTheme>['colors'], active: boolean) {
  return {
    backgroundColor: active ? colors.ink : colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  };
}
