import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { CustomerTabParamList } from '../types/navigation';
import { useTheme } from '../context/ThemeContext';
import { useChat } from '../context/ChatContext';
import HomeScreen from '../screens/customer/HomeScreen';
import SearchScreen from '../screens/customer/SearchScreen';
import MessagesListScreen from '../screens/shared/MessagesListScreen';
import CustomerBookingsScreen from '../screens/customer/CustomerBookingsScreen';
import CustomerProfileScreen from '../screens/customer/CustomerProfileScreen';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

const ICONS: Record<keyof CustomerTabParamList, string> = {
  Home: '🏠',
  Search: '🔍',
  Messages: '💬',
  Bookings: '📅',
  Profile: '👤',
};

export default function CustomerTabNavigator() {
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
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{ICONS[route.name as keyof CustomerTabParamList]}</Text>,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Search" component={SearchScreen} />
      <Tab.Screen
        name="Messages"
        component={MessagesListScreen}
        options={{
          tabBarBadge: totalUnread > 0 ? totalUnread : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.marigold, color: colors.ink, fontSize: 10 },
        }}
      />
      <Tab.Screen name="Bookings" component={CustomerBookingsScreen} options={{ title: 'My Bookings' }} />
      <Tab.Screen name="Profile" component={CustomerProfileScreen} />
    </Tab.Navigator>
  );
}
