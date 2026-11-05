import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    const token = localStorage.getItem('bulk_token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await authApi.getMe();
      setUser(data.user);
      setProfile(data.profile);
    } catch (err) {
      // Token invalid/expired - clear it silently.
      localStorage.removeItem('bulk_token');
      setUser(null);
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const signup = async (payload) => {
    const { data } = await authApi.signup(payload);
    localStorage.setItem('bulk_token', data.token);
    setUser(data.user);
    setProfile(data.profile);
    return data;
  };

  const login = async (payload) => {
    const { data } = await authApi.login(payload);
    localStorage.setItem('bulk_token', data.token);
    setUser(data.user);
    await loadMe();
    return data;
  };

  const logout = () => {
    // Best-effort: stop this device from receiving pushes for an account
    // it's no longer signed into. Not awaited - logout shouldn't hang on it.
    authApi.registerPushToken(null).catch(() => {});
    localStorage.removeItem('bulk_token');
    setUser(null);
    setProfile(null);
  };

  const updateProfile = (newProfile) => setProfile(newProfile);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, isAuthenticated: !!user, signup, login, logout, updateProfile, refresh: loadMe }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
