import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { ProviderTabParamList } from '../types/navigation';
import { useTheme } from '../context/ThemeContext';
import { useChat } from '../context/ChatContext';
import ProviderDashboardScreen from '../screens/provider/ProviderDashboardScreen';
import ProviderBookingsScreen from '../screens/provider/ProviderBookingsScreen';
import MessagesListScreen from '../screens/shared/MessagesListScreen';
import ProviderCalendarScreen from '../screens/provider/ProviderCalendarScreen';
import ProviderProfileScreen from '../screens/provider/ProviderProfileScreen';

const Tab = createBottomTabNavigator<ProviderTabParamList>();

const ICONS: Record<keyof ProviderTabParamList, string> = {
  Dashboard: '📊',
  ProviderBookings: '📋',
  Messages: '💬',
  Calendar: '🗓️',
  ProviderProfile: '👤',
};

export default function ProviderTabNavigator() {
  const { colors } = useTheme();
  const { totalUnread } = useChat();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: { color: colors.ink },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.slate,
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{ICONS[route.name as keyof ProviderTabParamList]}</Text>,
      })}
    >
      <Tab.Screen name="Dashboard" component={ProviderDashboardScreen} />
      <Tab.Screen name="ProviderBookings" component={ProviderBookingsScreen} options={{ title: 'Bookings' }} />
      <Tab.Screen
        name="Messages"
        component={MessagesListScreen}
        options={{
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.marigold, color: colors.ink, fontSize: 10 },
        }}
      />
      <Tab.Screen name="Calendar" component={ProviderCalendarScreen} />
      <Tab.Screen name="ProviderProfile" component={ProviderProfileScreen} options={{ title: 'Profile' }} />
    </Tab.Navigator>
  );
}
