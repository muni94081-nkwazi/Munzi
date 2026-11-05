import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Button, Input } from '../../components/ui';
import { promptBiometricUnlock } from '../../utils/biometrics';
import { spacing } from '../../theme/theme';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const { login, biometricAvailable, biometricEnabled } = useAuth();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [apiError, setApiError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async () => {
    const nextErrors: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) nextErrors.email = 'Enter a valid email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setApiError('');
    setSubmitting(true);
    try {
      await login({ email, password });
      // Root navigator swaps to the main app automatically once `user` is set.
    } catch (err: any) {
      setApiError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBiometricLogin = async () => {
    const success = await promptBiometricUnlock('Log in to Bulk');
    if (!success) setApiError('Biometric authentication failed. Please log in with your password.');
    // A stored session + successful prompt is handled by AuthContext's restoreSession
    // on app launch; this button is here for the case a user backed out of that
    // prompt and wants to retry without restarting the app.
  };

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, backgroundColor: colors.background, padding: spacing.xl, justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '700', color: colors.ink }}>Welcome back</Text>
      <Text style={{ color: colors.slate, marginTop: 6, marginBottom: spacing.xl }}>Log in to manage your bookings.</Text>

      {!!apiError && <Text style={{ color: colors.clay, marginBottom: spacing.md }}>{apiError}</Text>}

      <Input placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} error={errors.email} />
      <Input placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} error={errors.password} />

      <Button title={submitting ? 'Logging in…' : 'Log in'} onPress={handleLogin} loading={submitting} />

      {biometricAvailable && biometricEnabled && (
        <TouchableOpacity onPress={handleBiometricLogin} style={{ alignItems: 'center', marginTop: spacing.lg }}>
          <Text style={{ color: colors.ink, fontWeight: '600' }}>🔐 Use Face ID / Fingerprint</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')} style={{ alignItems: 'center', marginTop: spacing.lg }}>
        <Text style={{ color: colors.slate }}>Forgot your password?</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => navigation.navigate('Signup')} style={{ alignItems: 'center', marginTop: spacing.md }}>
        <Text style={{ color: colors.slate }}>
          Don't have an account? <Text style={{ color: colors.ink, fontWeight: '700' }}>Sign up</Text>
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}
