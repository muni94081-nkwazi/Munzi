import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { Card, LoadingView, ErrorView, EmptyState, Button, OfflineBanner } from '../../components/ui';
import { availabilityApi } from '../../api/availability';
import { DAYS_OF_WEEK } from '../../utils/constants';
import { spacing, radius } from '../../theme/theme';
import type { AvailabilityWindow } from '../../types/models';

export default function ProviderCalendarScreen() {
  const { colors } = useTheme();
  const [windows, setWindows] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [newWindow, setNewWindow] = useState({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await availabilityApi.listMine();
      setWindows(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (newWindow.startTime >= newWindow.endTime) return;
    setSubmitting(true);
    try {
      await availabilityApi.create(newWindow);
      setAdding(false);
      setNewWindow({ dayOfWeek: 1, startTime: '09:00', endTime: '17:00' });
      load();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (id: string) => {
    await availabilityApi.remove(id);
    load();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <OfflineBanner />
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>Availability</Text>
        <TouchableOpacity onPress={() => setAdding((a) => !a)}>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>{adding ? 'Cancel' : '+ Add window'}</Text>
        </TouchableOpacity>
      </View>

      {adding && (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: spacing.sm }}>New availability window</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.sm }}>
            {DAYS_OF_WEEK.map((d) => (
              <TouchableOpacity
                key={d.value}
                onPress={() => setNewWindow((w) => ({ ...w, dayOfWeek: d.value }))}
                style={{
                  backgroundColor: newWindow.dayOfWeek === d.value ? colors.ink : colors.background,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: radius.sm,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  marginRight: 6,
                }}
              >
                <Text style={{ color: newWindow.dayOfWeek === d.value ? colors.white : colors.ink, fontSize: 12 }}>{d.short}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
            <TextInput
              value={newWindow.startTime}
              onChangeText={(v) => setNewWindow((w) => ({ ...w, startTime: v }))}
              placeholder="09:00"
              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.ink }}
            />
            <TextInput
              value={newWindow.endTime}
              onChangeText={(v) => setNewWindow((w) => ({ ...w, endTime: v }))}
              placeholder="17:00"
              style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: 8, color: colors.ink }}
            />
          </View>
          <Button title={submitting ? 'Saving…' : 'Save window'} onPress={handleAdd} loading={submitting} />
        </Card>
      )}

      <View style={{ marginTop: spacing.lg }}>
        {loading && <LoadingView label="Loading your availability…" />}
        {!loading && error && <ErrorView message={error} onRetry={load} />}
        {!loading && !error && windows.length === 0 && (
          <EmptyState title="No availability set" description="Add a window so customers can book you." />
        )}
        {!loading &&
          !error &&
          DAYS_OF_WEEK.map((day) => {
            const dayWindows = windows.filter((w) => w.day_of_week === day.value);
            if (dayWindows.length === 0) return null;
            return (
              <Card key={day.value} style={{ marginBottom: spacing.md }}>
                <Text style={{ color: colors.ink, fontWeight: '700', marginBottom: spacing.sm }}>{day.label}</Text>
                {dayWindows.map((w) => (
                  <View key={w.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: colors.slate }}>
                      {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}
                    </Text>
                    <TouchableOpacity onPress={() => handleRemove(w.id)}>
                      <Text style={{ color: colors.clay, fontSize: 12, fontWeight: '600' }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </Card>
            );
          })}
      </View>
    </ScrollView>
  );
}
