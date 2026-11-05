import 'react-native-gesture-handler';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { NetworkProvider } from './src/context/NetworkContext';
import { ChatProvider } from './src/context/ChatContext';
import RootNavigator from './src/navigation/RootNavigator';
import { registerForPushNotificationsAsync, syncPushTokenWithBackend } from './src/utils/pushNotifications';
import { client } from './src/api/client';

function AppShell() {
  const { mode, colors } = useTheme();
  const { isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      syncPushTokenWithBackend(async (token) => {
        await client.patch('/auth/push-token', { token });
      }).catch(() => {});
    }
  }, [isAuthenticated]);

  return (
    <NavigationContainer
      theme={{
        dark: mode === 'dark',
        colors: {
          primary: colors.marigold,
          background: colors.background,
          card: colors.surface,
          text: colors.ink,
          border: colors.border,
          notification: colors.marigold,
        },
      }}
    >
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <NetworkProvider>
          <AuthProvider>
            <ChatProvider>
              <AppShell />
            </ChatProvider>
          </AuthProvider>
        </NetworkProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
