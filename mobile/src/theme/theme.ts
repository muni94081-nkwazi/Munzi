export type ThemeColors = {
  background: string;
  surface: string;
  ink: string;
  slate: string;
  marigold: string;
  forest: string;
  clay: string;
  border: string;
  white: string;
};

export type ThemeMode = 'light' | 'dark';

const lightColors: ThemeColors = {
  background: '#F3EEE1', // linen
  surface: '#FFFFFF',
  ink: '#16213D',
  slate: '#5B6472',
  marigold: '#F2A93B',
  forest: '#1F6F54',
  clay: '#A8523F',
  border: 'rgba(22,33,61,0.12)',
  white: '#FFFFFF',
};

const darkColors: ThemeColors = {
  background: '#0F1626',
  surface: '#1A2338',
  ink: '#F3EEE1',
  slate: '#9CA5B4',
  marigold: '#F2A93B',
  forest: '#3FA184',
  clay: '#D9756A',
  border: 'rgba(243,238,225,0.12)',
  white: '#FFFFFF',
};

export const themes: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 6, md: 10, lg: 14 };

export const typography = {
  display: { fontWeight: '700' as const },
  body: { fontWeight: '400' as const },
  mono: { fontFamily: 'Courier' as const }, // swap for a real monospace font once bundled
};
