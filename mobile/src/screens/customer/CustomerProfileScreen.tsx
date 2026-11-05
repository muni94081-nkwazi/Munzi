import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Button, Input, Card } from '../../components/ui';
import { customerApi } from '../../api/providers';
import type { CustomerProfile } from '../../types/models';
import { spacing } from '../../theme/theme';

export default function CustomerProfileScreen() {
  const { user, profile, updateProfile, logout, biometricAvailable, biometricEnabled, setBiometricEnabled } = useAuth();
  const { colors, mode, isSystemDefault, setMode } = useTheme();
  const customerProfile = profile as CustomerProfile | null;

  const [address, setAddress] = useState(customerProfile?.address || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const { data } = await customerApi.updateMe({ address });
      updateProfile(data);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>Your profile</Text>
      <Text style={{ color: colors.slate, marginBottom: spacing.lg }}>{user?.email}</Text>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: spacing.sm }}>Address</Text>
        <Input placeholder="Bugolobi, Kampala" value={address} onChangeText={setAddress} />
        {saved && <Text style={{ color: colors.forest, fontSize: 12, marginBottom: spacing.sm }}>Saved!</Text>}
        <Button title={saving ? 'Saving…' : 'Save changes'} onPress={handleSave} loading={saving} variant="secondary" />
      </Card>

      <Card style={{ marginBottom: spacing.lg }}>
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: spacing.md }}>Settings</Text>

        <Row label="Dark mode" description="Match device setting or choose manually">
          <Switch
            value={mode === 'dark'}
            onValueChange={(v) => setMode(v ? 'dark' : 'light')}
            trackColor={{ true: colors.marigold, false: colors.border }}
          />
        </Row>
        <TouchableOpacity onPress={() => setMode('system')} style={{ marginTop: -spacing.sm, marginBottom: spacing.md }}>
          <Text style={{ color: colors.slate, fontSize: 12 }}>
            {isSystemDefault ? '✓ Following system setting' : 'Reset to follow system setting'}
          </Text>
        </TouchableOpacity>

        {biometricAvailable && (
          <Row label="Biometric login" description="Use Face ID / Fingerprint to unlock Bulk">
            <Switch
              value={biometricEnabled}
              onValueChange={setBiometricEnabled}
              trackColor={{ true: colors.marigold, false: colors.border }}
            />
          </Row>
        )}
      </Card>

      <Button title="Log out" onPress={logout} variant="outline" />
    </ScrollView>
  );
}

function Row({ label, description, children }: { label: string; description: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md }}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>{label}</Text>
        <Text style={{ color: colors.slate, fontSize: 12, marginTop: 2 }}>{description}</Text>
      </View>
      {children}
    </View>
  );
}
