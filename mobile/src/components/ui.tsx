import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useNetwork } from '../context/NetworkContext';
import { spacing, radius } from '../theme/theme';
import type { BookingStatus } from '../types/models';

// ─── Button ───────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'outline';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const bg = variant === 'primary' ? colors.marigold : variant === 'secondary' ? colors.ink : 'transparent';
  const textColor = variant === 'outline' ? colors.ink : variant === 'primary' ? colors.ink : colors.white;
  const border = variant === 'outline' ? colors.border : 'transparent';

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.button,
        { backgroundColor: bg, borderColor: border, borderWidth: variant === 'outline' ? 1 : 0, opacity: disabled ? 0.5 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={textColor} /> : <Text style={[styles.buttonText, { color: textColor }]}>{title}</Text>}
    </TouchableOpacity>
  );
}

// ─── Card / "ticket" surface ────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, borderTopColor: colors.marigold },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ─── Status badge ("stamped ticket") ───────────────────────────────
const STATUS_COLOR_KEY: Record<BookingStatus, 'marigold' | 'forest' | 'ink' | 'clay'> = {
  pending: 'marigold',
  confirmed: 'forest',
  completed: 'ink',
  cancelled: 'clay',
};

export function StatusBadge({ status }: { status: BookingStatus }) {
  const { colors } = useTheme();
  const color = colors[STATUS_COLOR_KEY[status]];
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}

// ─── Star rating ─────────────────────────────────────────────────────
export function StarRating({ rating = 0, showValue = true }: { rating?: number; showValue?: boolean }) {
  const { colors } = useTheme();
  const full = Math.round(rating);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ color: colors.marigold, letterSpacing: -1 }}>
        {'★'.repeat(full)}
        <Text style={{ color: colors.border }}>{'★'.repeat(5 - full)}</Text>
      </Text>
      {showValue && <Text style={{ color: colors.slate, fontSize: 12 }}>{rating.toFixed(1)}</Text>}
    </View>
  );
}

// ─── Loading / Empty / Error states ──────────────────────────────────
export function LoadingView({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={colors.marigold} />
      <Text style={{ color: colors.slate, marginTop: spacing.sm }}>{label}</Text>
    </View>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.centered}>
      <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 16 }}>{title}</Text>
      {description && (
        <Text style={{ color: colors.slate, fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: spacing.xl }}>
          {description}
        </Text>
      )}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.clay + '4D' }]}>
      <Text style={{ color: colors.clay, fontSize: 13 }}>{message}</Text>
      {onRetry && (
        <TouchableOpacity onPress={onRetry} style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.ink, fontWeight: '700', textDecorationLine: 'underline' }}>Try again</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── Text input ───────────────────────────────────────────────────────
export function Input({ error, ...props }: TextInputProps & { error?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <TextInput
        placeholderTextColor={colors.slate}
        style={[
          styles.input,
          { borderColor: error ? colors.clay : colors.border, color: colors.ink, backgroundColor: colors.surface },
        ]}
        {...props}
      />
      {error && <Text style={{ color: colors.clay, fontSize: 12, marginTop: 4 }}>{error}</Text>}
    </View>
  );
}

// ─── Offline banner ─────────────────────────────────────────────────
export function OfflineBanner() {
  const { isOffline } = useNetwork();
  const { colors } = useTheme();
  if (!isOffline) return null;
  return (
    <View style={{ backgroundColor: colors.clay, paddingVertical: 6, alignItems: 'center' }}>
      <Text style={{ color: colors.white, fontSize: 12, fontWeight: '600' }}>
        You're offline — showing the last data we saved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '700', fontSize: 15 },
  card: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderTopWidth: 3,
    padding: spacing.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1.5,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xxl },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 15,
  },
});
