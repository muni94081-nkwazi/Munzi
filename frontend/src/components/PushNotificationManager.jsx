import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { requestPermissionAndGetToken, onForegroundMessage } from '../utils/pushNotifications';
import { authApi } from '../api/auth';

/**
 * Mounted once near the top of the authenticated app (see App.jsx). Has no
 * visible output of its own - it just:
 *  1. On login, asks for notification permission and registers the
 *     resulting FCM token with the backend (PATCH /auth/push-token).
 *  2. While the app is open and focused, shows a toast for any push that
 *     arrives (background/closed-tab pushes are handled by the service
 *     worker instead - see public/firebase-messaging-sw.js).
 *  3. On logout, clears the token server-side so this device stops
 *     receiving pushes for an account it's no longer signed into.
 */
export default function PushNotificationManager() {
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAuthenticated) return;

    let cancelled = false;

    requestPermissionAndGetToken().then((token) => {
      if (!cancelled && token) {
        authApi.registerPushToken(token).catch((err) => {
          console.warn('Failed to register push token with backend:', err.message);
        });
      }
    });

    let unsubscribe = () => {};
    onForegroundMessage((payload) => {
      const { title, body } = payload.notification || {};
      const bookingId = payload.data?.bookingId;
      showToast(`${title ? `${title}: ` : ''}${body || ''}`.trim(), 'success');
      // Clicking a foreground toast could also route the user, but since
      // this fires while they're already in the app, we leave navigation
      // to the notification bell / My Bookings rather than yanking them
      // off whatever page they're on.
      void bookingId;
    }).then((unsub) => {
      if (cancelled) unsub();
      else unsubscribe = unsub;
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isAuthenticated, showToast]);

  // Support the service worker's notification-click deep link
  // (/bookings?bookingId=...) by navigating once on mount if present.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const bookingId = params.get('bookingId');
    if (bookingId && window.location.pathname === '/bookings') {
      navigate('/bookings', { replace: true });
    }
  }, [navigate]);

  return null;
}
