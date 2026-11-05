import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation';
import type { Role } from '../../types/models';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Button, Input } from '../../components/ui';
import { spacing, radius } from '../../theme/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Signup'>;

export default function SignupScreen({ navigation }: Props) {
  const { signup } = useAuth();
  const { colors } = useTheme();
  const [role, setRole] = useState<Role>('customer');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const update = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    const nextErrors: Record<string, string> = {};
    if (form.fullName.trim().length < 2) nextErrors.fullName = 'Enter your full name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) nextErrors.email = 'Enter a valid email address.';
    if (form.password.length < 8) nextErrors.password = 'Password must be at least 8 characters.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setApiError('');
    setSubmitting(true);
    try {
      await signup({
        email: form.email,
        password: form.password,
        role,
        phone: form.phone,
        ...(role === 'provider' ? { businessName: form.fullName, category: 'general' } : { fullName: form.fullName }),
      });
      // RootNavigator will route to the right main stack once authenticated;
      // profile-setup screens can be reached from there for now.
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.xl }}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink, marginTop: spacing.lg }}>Create your account</Text>
      <Text style={{ color: colors.slate, marginTop: 6, marginBottom: spacing.lg }}>
        Join Bulk to book trusted local services, or offer your own.
      </Text>

      <View style={[styles.toggleRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {(['customer', 'provider'] as Role[]).map((r) => (
          <TouchableOpacity
            key={r}
            onPress={() => setRole(r)}
            style={[styles.toggleBtn, { backgroundColor: role === r ? colors.ink : 'transparent' }]}
          >
            <Text style={{ color: role === r ? colors.white : colors.slate, fontWeight: '700', textTransform: 'capitalize' }}>
              I'm a {r}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!!apiError && <Text style={{ color: colors.clay, marginVertical: spacing.md }}>{apiError}</Text>}

      <View style={{ marginTop: spacing.lg }}>
        <Input placeholder="Full name" value={form.fullName} onChangeText={(v) => update('fullName', v)} error={errors.fullName} />
        <Input
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          onChangeText={(v) => update('email', v)}
          error={errors.email}
        />
        <Input
          placeholder="Phone number"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => update('phone', v)}
        />
        <Input
          placeholder="Password (min. 8 characters)"
          secureTextEntry
          value={form.password}
          onChangeText={(v) => update('password', v)}
          error={errors.password}
        />
      </View>

      <Button title={submitting ? 'Creating account…' : 'Create account'} onPress={handleSubmit} loading={submitting} />

      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Text style={{ color: colors.slate }}>
          Already have an account? <Text style={{ color: colors.ink, fontWeight: '700' }}>Log in</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  toggleRow: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, padding: 4, gap: 4 },
  toggleBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
});
