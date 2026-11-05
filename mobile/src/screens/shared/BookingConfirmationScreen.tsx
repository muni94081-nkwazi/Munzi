import React from 'react';
import { View, Text } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { Card, Button } from '../../components/ui';
import { formatCurrency, formatDate, formatTime } from '../../utils/formatters';
import { spacing } from '../../theme/theme';

type Props = NativeStackScreenProps<RootStackParamList, 'BookingConfirmation'>;

export default function BookingConfirmationScreen({ route, navigation }: Props) {
  const { booking, service, provider } = route.params;
  const { colors } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: 'center' }}>
      <View style={{ alignItems: 'center' }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.forest + '20',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 30, color: colors.forest }}>✓</Text>
        </View>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink, marginTop: spacing.md }}>Booking requested!</Text>
        <Text style={{ color: colors.slate, textAlign: 'center', marginTop: spacing.sm }}>
          {provider.business_name} will confirm your appointment shortly.
        </Text>
      </View>

      <Card style={{ marginTop: spacing.xl }}>
        <Row label="Service" value={service.title} colors={colors} />
        <Row label="Date" value={formatDate(booking.booking_date)} colors={colors} />
        <Row label="Time" value={formatTime(booking.start_time)} colors={colors} />
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm, paddingTop: spacing.sm }}>
          <Row label="Total" value={formatCurrency(service.price)} colors={colors} bold />
        </View>
      </Card>

      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl }}>
        <View style={{ flex: 1 }}>
          <Button title="Back home" onPress={() => navigation.popToTop()} variant="outline" />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="My bookings" onPress={() => navigation.reset({ index: 0, routes: [{ name: 'CustomerTabs' }] })} />
        </View>
      </View>
    </View>
  );
}

function Row({ label, value, colors, bold }: { label: string; value: string; colors: ReturnType<typeof useTheme>['colors']; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
      <Text style={{ color: colors.slate, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: bold ? '700' : '600' }}>{value}</Text>
    </View>
  );
}
