import { getToken, onMessage } from 'firebase/messaging';
import { getMessagingIfSupported } from '../firebase';

/**
 * Registers the Firebase messaging service worker, asks the user for
 * notification permission if needed, and returns an FCM token - or null if
 * any step isn't available/granted (unsupported browser, permission
 * denied, no VAPID key configured, etc). Callers should treat null as
 * "push just isn't available right now," not as an error to surface.
 */
export async function requestPermissionAndGetToken() {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return null;

  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
  if (!vapidKey) {
    console.warn('VITE_FIREBASE_VAPID_KEY is not set - cannot request an FCM token.');
    return null;
  }

  try {
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: registration });
    return token || null;
  } catch (err) {
    console.error('Failed to get FCM token:', err);
    return null;
  }
}

/**
 * Subscribes to messages that arrive while the app has an open, focused tab
 * (the "foreground" case - background/closed is handled by the service
 * worker instead). Returns an unsubscribe function for cleanup in a
 * useEffect.
 *
 * @param {(payload: { notification?: { title, body }, data?: object }) => void} callback
 */
export async function onForegroundMessage(callback) {
  const messaging = await getMessagingIfSupported();
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
}
