import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { themes, ThemeColors, ThemeMode } from '../theme/theme';

type ThemeContextValue = {
  mode: ThemeMode;
  colors: ThemeColors;
  isSystemDefault: boolean;
  setMode: (mode: ThemeMode | 'system') => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = 'bulk_theme_preference';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemeMode | 'system'>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') setPreference(saved);
    });
  }, []);

  const setMode = (next: ThemeMode | 'system') => {
    setPreference(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const resolvedMode: ThemeMode = preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo(
    () => ({
      mode: resolvedMode,
      colors: themes[resolvedMode],
      isSystemDefault: preference === 'system',
      setMode,
    }),
    [resolvedMode, preference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
