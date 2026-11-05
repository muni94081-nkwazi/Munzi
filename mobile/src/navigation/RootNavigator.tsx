import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { LoadingView } from '../components/ui';

import AuthNavigator from './AuthNavigator';
import CustomerTabNavigator from './CustomerTabNavigator';
import ProviderTabNavigator from './ProviderTabNavigator';

import ProviderDetailScreen from '../screens/shared/ProviderDetailScreen';
import BookingFlowScreen from '../screens/shared/BookingFlowScreen';
import BookingConfirmationScreen from '../screens/shared/BookingConfirmationScreen';
import ChatScreen from '../screens/shared/ChatScreen';
import ReviewsScreen from '../screens/shared/ReviewsScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { isAuthenticated, user, loading } = useAuth();
  const { colors } = useTheme();

  if (loading) return <LoadingView label="Loading Bulk…" />;

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.ink }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Auth" component={AuthNavigator} options={{ headerShown: false }} />
      ) : (
        <>
          {user?.role === 'provider' ? (
            <Stack.Screen name="ProviderTabs" component={ProviderTabNavigator} options={{ headerShown: false }} />
          ) : (
            <Stack.Screen name="CustomerTabs" component={CustomerTabNavigator} options={{ headerShown: false }} />
          )}
          <Stack.Screen name="ProviderDetail" component={ProviderDetailScreen} options={{ title: 'Provider' }} />
          <Stack.Screen name="BookingFlow" component={BookingFlowScreen} options={{ title: 'Book appointment' }} />
          <Stack.Screen name="BookingConfirmation" component={BookingConfirmationScreen} options={{ title: 'Confirmed', headerBackVisible: false }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Messages' }} />
          <Stack.Screen name="Reviews" component={ReviewsScreen} options={{ title: 'Reviews' }} />
        </>
      )}
    </Stack.Navigator>
  );
}
