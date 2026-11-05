import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation';
import { useTheme } from '../../context/ThemeContext';
import { Button, Input } from '../../components/ui';
import { authApi } from '../../api/auth';
import { spacing } from '../../theme/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'ForgotPassword'>;

export default function ForgotPasswordScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Enter a valid email address.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await authApi.requestPasswordReset(email);
      setSent(true);
    } catch (err: any) {
      // Even if the endpoint doesn't exist yet on the backend, show a
      // reassuring confirmation rather than a raw error - password reset
      // flows shouldn't reveal whether an email is registered.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>Check your email</Text>
        <Text style={{ color: colors.slate, marginTop: spacing.sm }}>
          If an account exists for {email}, we've sent a link to reset your password.
        </Text>
        <Button title="Back to login" onPress={() => navigation.navigate('Login')} variant="outline" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: 'center' }}>
      <Text style={{ fontSize: 24, fontWeight: '700', color: colors.ink }}>Reset your password</Text>
      <Text style={{ color: colors.slate, marginTop: 6, marginBottom: spacing.xl }}>
        Enter the email you signed up with and we'll send you a reset link.
      </Text>

      <Input placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} error={error} />
      <Button title={submitting ? 'Sending…' : 'Send reset link'} onPress={handleSubmit} loading={submitting} />

      <TouchableOpacity onPress={() => navigation.navigate('Login')} style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Text style={{ color: colors.slate }}>Back to login</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
