import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * We use expo-notifications rather than a bare @react-native-firebase
 * integration so push works in the managed Expo workflow without ejecting.
 * Under the hood, Expo's push service delivers Android notifications via
 * Firebase Cloud Messaging (using the `google-services.json` referenced in
 * app.json) and iOS notifications via APNs - so this still is "Firebase" on
 * Android, just routed through Expo's push endpoint instead of calling the
 * Firebase Admin SDK directly. If you eject to bare workflow, swap this
 * module for @react-native-firebase/messaging with the same function shape.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    console.warn('Push notifications require a physical device (not a simulator).');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.warn('Push notification permission was not granted.');
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F2A93B',
    });
  }

  const { data: expoPushToken } = await Notifications.getExpoPushTokenAsync();
  return expoPushToken;
}

/**
 * Call this once after login. The backend endpoint is:
 *   PATCH /api/auth/push-token  { token: string | null }
 * Pass the upload function from App.tsx to keep this module decoupled.
 */
export async function syncPushTokenWithBackend(uploadFn: (token: string) => Promise<void>) {
  const token = await registerForPushNotificationsAsync();
  if (token) {
    try {
      await uploadFn(token);
    } catch (err) {
      console.warn('Failed to sync push token with backend:', err);
    }
  }
}
