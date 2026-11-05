import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authApi, SignupPayload } from '../api/auth';
import { promptBiometricUnlock, isBiometricAvailable } from '../utils/biometrics';
import type { User, ProviderProfile, CustomerProfile } from '../types/models';

type Profile = ProviderProfile | CustomerProfile | null;

type AuthContextValue = {
  user: User | null;
  profile: Profile;
  loading: boolean;
  isAuthenticated: boolean;
  biometricEnabled: boolean;
  biometricAvailable: boolean;
  signup: (payload: SignupPayload) => Promise<{ user: User; profile: Profile }>;
  login: (payload: { email: string; password: string }) => Promise<{ user: User }>;
  logout: () => Promise<void>;
  updateProfile: (p: Profile) => void;
  setBiometricEnabled: (enabled: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const TOKEN_KEY = 'bulk_token';
const BIOMETRIC_KEY = 'bulk_biometric_enabled';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [loading, setLoading] = useState(true);
  const [biometricEnabled, setBiometricEnabledState] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      const biometricPref = (await AsyncStorage.getItem(BIOMETRIC_KEY)) === 'true';
      const available = await isBiometricAvailable();
      setBiometricAvailable(available);
      setBiometricEnabledState(biometricPref);

      if (!token) {
        setLoading(false);
        return;
      }

      if (biometricPref && available) {
        const unlocked = await promptBiometricUnlock('Unlock Bulk');
        if (!unlocked) {
          setLoading(false);
          return; // Leave the user logged out until they retry or use another method.
        }
      }

      const { data } = await authApi.getMe();
      setUser(data.user);
      setProfile(data.profile);
    } catch {
      await AsyncStorage.removeItem(TOKEN_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const signup = async (payload: SignupPayload) => {
    const { data } = await authApi.signup(payload);
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    setProfile(data.profile);
    return { user: data.user, profile: data.profile };
  };

  const login = async (payload: { email: string; password: string }) => {
    const { data } = await authApi.login(payload);
    await AsyncStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    const me = await authApi.getMe();
    setProfile(me.data.profile);
    return { user: data.user };
  };

  const logout = async () => {
    await AsyncStorage.removeItem(TOKEN_KEY);
    setUser(null);
    setProfile(null);
  };

  const setBiometricEnabled = async (enabled: boolean) => {
    await AsyncStorage.setItem(BIOMETRIC_KEY, enabled ? 'true' : 'false');
    setBiometricEnabledState(enabled);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        isAuthenticated: !!user,
        biometricEnabled,
        biometricAvailable,
        signup,
        login,
        logout,
        updateProfile: setProfile,
        setBiometricEnabled,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
