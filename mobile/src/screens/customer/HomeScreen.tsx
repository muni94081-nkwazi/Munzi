import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, FlatList, RefreshControl } from 'react-native';
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
  BottomTabScreenProps<CustomerTabParamList, 'Home'>,
  NativeStackScreenProps<RootStackParamList>
>;

export default function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const { data } = await providerApi.list({ limit: 6 });
      setProviders(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const goSearch = () => {
    navigation.navigate('Search', { query });
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.marigold} />}
    >
      <OfflineBanner />
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, marginTop: spacing.sm }}>
        Trusted local help, booked in minutes.
      </Text>

      <TouchableOpacity
        onPress={goSearch}
        style={{
          marginTop: spacing.lg,
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          paddingVertical: 12,
        }}
      >
        <TextInput
          placeholder="Search for a service or provider…"
          placeholderTextColor={colors.slate}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={goSearch}
          style={{ color: colors.ink }}
        />
      </TouchableOpacity>

      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: spacing.xl, marginBottom: spacing.md }}>
        Browse by category
      </Text>
      <FlatList
        data={CATEGORIES}
        keyExtractor={(c) => c.value}
        numColumns={4}
        scrollEnabled={false}
        columnWrapperStyle={{ gap: spacing.sm }}
        contentContainerStyle={{ gap: spacing.sm }}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate('Search', { category: item.value })}
            style={{
              flex: 1,
              alignItems: 'center',
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingVertical: spacing.md,
            }}
          >
            <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
            <Text style={{ fontSize: 11, color: colors.ink, marginTop: 4, textAlign: 'center' }}>{item.label}</Text>
          </TouchableOpacity>
        )}
      />

      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, marginTop: spacing.xl, marginBottom: spacing.md }}>
        Recommended for you
      </Text>
      {loading && <LoadingView label="Finding great providers…" />}
      {!loading && error && <ErrorView message={error} onRetry={load} />}
      {!loading && !error && providers.length === 0 && <EmptyState title="No providers yet" description="Check back soon." />}
      {!loading &&
        !error &&
        providers.map((p) => (
          <ProviderCard key={p.id} provider={p} onPress={() => navigation.navigate('ProviderDetail', { providerId: p.id })} />
        ))}
    </ScrollView>
  );
}
