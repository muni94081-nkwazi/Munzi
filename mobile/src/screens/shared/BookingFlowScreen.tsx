import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import type { AvailabilityWindow } from '../../types/models';
import { useTheme } from '../../context/ThemeContext';
import { Card, Input, Button, ErrorView } from '../../components/ui';
import { Calendar } from '../../components/Calendar';
import { bookingApi } from '../../api/bookings';
import { availabilityApi } from '../../api/availability';
import { buildSlots } from '../../utils/constants';
import { formatCurrency, formatDuration, formatDate, formatTime } from '../../utils/formatters';
import { spacing, radius } from '../../theme/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'BookingFlow'>;

export default function BookingFlowScreen({ route, navigation }: Props) {
  const { service, provider } = route.params;
  const { colors } = useTheme();

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);

  useEffect(() => {
    availabilityApi.listForProvider(provider.id)
      .then((res) => setAvailability(res.data || []))
      .catch(() => {});
  }, [provider.id]);

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    
    // JS getDay() matches our day_of_week enum (0=Sun, 6=Sat)
    const dayOfWeek = new Date(selectedDate).getDay();
    const dayWindows = availability.filter((w) => w.day_of_week === dayOfWeek && w.is_available);

    if (dayWindows.length === 0) return []; // No availability on this day

    // Combine slots for all windows on this day
    const allSlots = dayWindows.flatMap((window) => {
      return buildSlots(window.start_time, window.end_time, 30);
    });

    // Remove duplicates and sort
    return Array.from(new Set(allSlots)).sort();
  }, [selectedDate, availability]);

  const handleConfirm = async () => {
    if (!selectedDate || !selectedTime) return;
    setSubmitting(true);
    setError('');
    try {
      const { data } = await bookingApi.create({
        serviceId: service.id,
        bookingDate: selectedDate,
        startTime: selectedTime,
        notes,
      });
      navigation.replace('BookingConfirmation', { booking: data, service, provider });
    } catch (err: any) {
      setError(err.message);
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>Book {service.title}</Text>
      <Text style={{ color: colors.slate, marginBottom: spacing.md }}>with {provider.business_name}</Text>

      <Card style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.lg }}>
        <View>
          <Text style={{ color: colors.ink, fontWeight: '600' }}>{service.title}</Text>
          <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>{formatDuration(service.duration_minutes)}</Text>
        </View>
        <Text style={{ color: colors.ink, fontWeight: '700' }}>{formatCurrency(service.price)}</Text>
      </Card>

      {!!error && <ErrorView message={error} />}

      <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: spacing.sm }}>1. Select a date</Text>
      <Calendar selectedDate={selectedDate} onSelect={setSelectedDate} />

      {selectedDate && (
        <>
          <Text style={{ fontWeight: '700', color: colors.ink, marginTop: spacing.lg, marginBottom: spacing.sm }}>2. Select a time</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
            {slots.map((slot) => {
              const isSelected = selectedTime === slot;
              return (
                <TouchableOpacity
                  key={slot}
                  onPress={() => setSelectedTime(slot)}
                  style={{
                    borderWidth: 1,
                    borderColor: isSelected ? colors.marigold : colors.border,
                    backgroundColor: isSelected ? colors.marigold : colors.surface,
                    borderRadius: radius.sm,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                  }}
                >
                  <Text style={{ color: colors.ink, fontWeight: isSelected ? '700' : '400', fontSize: 12 }}>{formatTime(slot)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <Text style={{ fontWeight: '700', color: colors.ink, marginTop: spacing.lg, marginBottom: spacing.sm }}>
        Special requests (optional)
      </Text>
      <Input placeholder="Anything the provider should know?" multiline numberOfLines={3} value={notes} onChangeText={setNotes} />

      <Button title="Review booking" onPress={() => setConfirmOpen(true)} disabled={!selectedDate || !selectedTime} />

      <Modal visible={confirmOpen} transparent animationType="slide" onRequestClose={() => setConfirmOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: spacing.xl }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: spacing.md }}>Confirm your booking</Text>
            <SummaryRow label="Provider" value={provider.business_name} colors={colors} />
            <SummaryRow label="Service" value={service.title} colors={colors} />
            <SummaryRow label="Date" value={formatDate(selectedDate || undefined)} colors={colors} />
            <SummaryRow label="Time" value={formatTime(selectedTime || undefined)} colors={colors} />
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm }}>
              <SummaryRow label="Total" value={formatCurrency(service.price)} colors={colors} bold />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
              <View style={{ flex: 1 }}>
                <Button title="Back" onPress={() => setConfirmOpen(false)} variant="outline" />
              </View>
              <View style={{ flex: 1 }}>
                <Button title={submitting ? 'Booking…' : 'Confirm'} onPress={handleConfirm} loading={submitting} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

function SummaryRow({ label, value, colors, bold }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors']; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ color: colors.slate, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: bold ? '700' : '600' }}>{value}</Text>
    </View>
  );
}
