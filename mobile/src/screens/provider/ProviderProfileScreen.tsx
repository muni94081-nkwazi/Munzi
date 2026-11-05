import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { Card, Input, Button, LoadingView, ErrorView, EmptyState, OfflineBanner } from '../../components/ui';
import { providerApi } from '../../api/providers';
import { serviceApi } from '../../api/services';
import { CATEGORIES } from '../../utils/constants';
import { formatCurrency, formatDuration } from '../../utils/formatters';
import { spacing, radius } from '../../theme/theme';
import type { ProviderProfile, Service } from '../../types/models';

export default function ProviderProfileScreen() {
  const { user, profile, updateProfile, logout, biometricAvailable, biometricEnabled, setBiometricEnabled } = useAuth();
  const { colors, mode, isSystemDefault, setMode } = useTheme();
  const providerProfile = profile as ProviderProfile | null;

  const [form, setForm] = useState({
    businessName: providerProfile?.business_name || '',
    category: providerProfile?.category || CATEGORIES[0].value,
    description: providerProfile?.description || '',
    location: providerProfile?.location || '',
  });
  const [saving, setSaving] = useState(false);

  const [services, setServices] = useState<Service[]>([]);
  const [servicesLoading, setServicesLoading] = useState(true);
  const [servicesError, setServicesError] = useState('');
  const [addingService, setAddingService] = useState(false);
  const [newService, setNewService] = useState({ title: '', price: '', duration: '' });
  const [savingService, setSavingService] = useState(false);

  const loadServices = useCallback(async () => {
    if (!providerProfile) return;
    setServicesLoading(true);
    setServicesError('');
    try {
      const { data } = await serviceApi.list({ providerId: providerProfile.id });
      setServices(data);
    } catch (err: any) {
      setServicesError(err.message);
    } finally {
      setServicesLoading(false);
    }
  }, [providerProfile]);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const { data } = await providerApi.updateMe({
        business_name: form.businessName,
        category: form.category,
        description: form.description,
        location: form.location,
      } as Partial<ProviderProfile>);
      updateProfile(data);
    } finally {
      setSaving(false);
    }
  };

  const handleAddService = async () => {
    if (!newService.title.trim() || !newService.price || !newService.duration) return;
    setSavingService(true);
    try {
      await serviceApi.create({
        title: newService.title,
        price: Number(newService.price),
        durationMinutes: Number(newService.duration),
      });
      setNewService({ title: '', price: '', duration: '' });
      setAddingService(false);
      loadServices();
    } finally {
      setSavingService(false);
    }
  };

  const handleRemoveService = async (id: string) => {
    await serviceApi.remove(id);
    loadServices();
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg }}>
      <OfflineBanner />
      <Text style={{ fontSize: 22, fontWeight: '700', color: colors.ink }}>Your business</Text>
      <Text style={{ color: colors.slate, marginBottom: spacing.lg }}>{user?.email}</Text>

      <Card style={{ marginBottom: spacing.lg }}>
        <Input placeholder="Business name" value={form.businessName} onChangeText={(v) => setForm((f) => ({ ...f, businessName: v }))} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity
              key={c.value}
              onPress={() => setForm((f) => ({ ...f, category: c.value }))}
              style={{
                backgroundColor: form.category === c.value ? colors.ink : colors.background,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 999,
                paddingHorizontal: 12,
                paddingVertical: 7,
                marginRight: 8,
              }}
            >
              <Text style={{ color: form.category === c.value ? colors.white : colors.ink, fontSize: 12 }}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <Input placeholder="Location (e.g. Kampala, Kololo)" value={form.location} onChangeText={(v) => setForm((f) => ({ ...f, location: v }))} />
        <Input
          placeholder="Description"
          multiline
          numberOfLines={3}
          value={form.description}
          onChangeText={(v) => setForm((f) => ({ ...f, description: v }))}
        />
        <Button title={saving ? 'Saving…' : 'Save changes'} onPress={handleSaveProfile} loading={saving} variant="secondary" />
      </Card>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.md }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>Your services</Text>
        <TouchableOpacity onPress={() => setAddingService((a) => !a)}>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>{addingService ? 'Cancel' : '+ Add'}</Text>
        </TouchableOpacity>
      </View>

      {addingService && (
        <Card style={{ marginBottom: spacing.md }}>
          <Input placeholder="Service title" value={newService.title} onChangeText={(v) => setNewService((s) => ({ ...s, title: v }))} />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Input
                placeholder="Price (UGX)"
                keyboardType="numeric"
                value={newService.price}
                onChangeText={(v) => setNewService((s) => ({ ...s, price: v }))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Input
                placeholder="Duration (min)"
                keyboardType="numeric"
                value={newService.duration}
                onChangeText={(v) => setNewService((s) => ({ ...s, duration: v }))}
              />
            </View>
          </View>
          <Button title={savingService ? 'Saving…' : 'Add service'} onPress={handleAddService} loading={savingService} />
        </Card>
      )}

      {servicesLoading && <LoadingView label="Loading services…" />}
      {!servicesLoading && servicesError && <ErrorView message={servicesError} onRetry={loadServices} />}
      {!servicesLoading && !servicesError && services.length === 0 && <EmptyState title="No services yet" description="Add your first service above." />}
      {!servicesLoading &&
        !servicesError &&
        services.map((s) => (
          <Card key={s.id} style={{ marginBottom: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={{ color: colors.ink, fontWeight: '600' }}>{s.title}</Text>
              <Text style={{ color: colors.slate, fontSize: 12 }}>
                {formatCurrency(s.price)} · {formatDuration(s.duration_minutes)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleRemoveService(s.id)}>
              <Text style={{ color: colors.clay, fontSize: 12, fontWeight: '600' }}>Remove</Text>
            </TouchableOpacity>
          </Card>
        ))}

      <Card style={{ marginTop: spacing.xl, marginBottom: spacing.lg }}>
        <Text style={{ fontWeight: '700', color: colors.ink, marginBottom: spacing.md }}>Settings</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
          <Text style={{ color: colors.ink, fontSize: 14 }}>Dark mode</Text>
          <Switch value={mode === 'dark'} onValueChange={(v) => setMode(v ? 'dark' : 'light')} trackColor={{ true: colors.marigold, false: colors.border }} />
        </View>
        <TouchableOpacity onPress={() => setMode('system')} style={{ marginBottom: spacing.md }}>
          <Text style={{ color: colors.slate, fontSize: 12 }}>{isSystemDefault ? '✓ Following system setting' : 'Reset to follow system setting'}</Text>
        </TouchableOpacity>
        {biometricAvailable && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: colors.ink, fontSize: 14 }}>Biometric login</Text>
            <Switch value={biometricEnabled} onValueChange={setBiometricEnabled} trackColor={{ true: colors.marigold, false: colors.border }} />
          </View>
        )}
      </Card>

      <Button title="Log out" onPress={logout} variant="outline" />
    </ScrollView>
  );
}
