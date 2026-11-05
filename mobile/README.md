# Bulk — Mobile (Expo)

React Native (Expo, managed workflow) app for the Bulk service booking
platform. Pairs with the `bulk-backend` Express/PostgreSQL API.

## Stack

- Expo SDK 51 + React Native 0.74, TypeScript
- React Navigation v6 (native-stack + bottom-tabs), with a fully typed
  `RootStackParamList` / `AuthStackParamList` / `CustomerTabParamList` /
  `ProviderTabParamList` (see `src/types/navigation.ts`)
- Axios (JWT-attaching interceptor, same shape as the web app)
- AsyncStorage for the session token and an offline response cache
- Context API: `AuthContext`, `ThemeContext` (dark mode), `NetworkContext`
- `expo-notifications` for push, `expo-local-authentication` for biometrics

## Setup

```bash
npm install
npx expo start
```

Scan the QR code with Expo Go (iOS/Android), or press `i` / `a` for a
simulator/emulator. Point the app at your backend by editing
`extra.apiBaseUrl` in `app.json`.

Type-check the whole project:

```bash
npm run typecheck
```

## Project structure

```
App.tsx                  # entry point: providers + NavigationContainer
src/
  api/                    # one file per resource, mirrors bulk-backend's routes
  components/             # ui.tsx (Button/Card/Input/etc.), ProviderCard, Calendar
  context/                # AuthContext, ThemeContext, NetworkContext
  navigation/             # AuthNavigator, CustomerTabNavigator, ProviderTabNavigator, RootNavigator
  screens/
    auth/                 # Login, Signup, ForgotPassword
    customer/              # Home, Search, Bookings, Profile (bottom tabs)
    provider/              # Dashboard, Bookings, Calendar, Profile (bottom tabs)
    shared/                 # ProviderDetail, BookingFlow, BookingConfirmation, Chat, Reviews
  theme/                  # light/dark color tokens, spacing, radius
  types/                  # domain models + navigation param lists
  utils/                  # formatters, constants, pushNotifications, biometrics
```

## Navigation

`RootNavigator` renders `AuthNavigator` when logged out, or
`CustomerTabNavigator` / `ProviderTabNavigator` (chosen by `user.role`) plus
the shared stack screens (Provider Detail, Booking Flow, Booking
Confirmation, Chat, Reviews) when logged in. Every screen's props are typed
via `NativeStackScreenProps<RootStackParamList, 'ScreenName'>` (or a
`CompositeScreenProps` for tab screens that also push shared stack screens),
so `navigation.navigate(...)` calls are checked against each screen's actual
param shape at compile time.

## Push notifications (Firebase)

We use `expo-notifications` rather than a bare `@react-native-firebase`
integration so push works in the managed workflow without ejecting. On
Android, Expo's push service still delivers through Firebase Cloud
Messaging under the hood — you provide your `google-services.json` (see
`app.json`'s `android.googleServicesFile`) and Expo handles the FCM
plumbing. On iOS it routes through APNs. `src/utils/pushNotifications.ts`
requests permission and returns an Expo push token; wire
`syncPushTokenWithBackend` to a real endpoint once `bulk-backend` exposes
one (e.g. `POST /users/me/push-token`) — it doesn't yet.

If you eject to the bare workflow, swap that module for
`@react-native-firebase/messaging` — the exported function shape
(`registerForPushNotificationsAsync` → returns a token string) can stay the
same so nothing else in the app needs to change.

## Offline support

`src/api/client.ts` exports `fetchWithCache`, used by every "browse" GET
(providers list/detail, services, availability, bookings, reviews). It
tries the network first and caches successful responses in AsyncStorage; if
the request fails (typically because the device is offline), it serves the
last cached response instead of a blank/error screen. `OfflineBanner`
(shown at the top of Home, Search, Bookings, Dashboard, and Calendar) tells
the user when they're looking at cached data.

## Biometric authentication

Toggle "Biometric login" in either Profile screen. When enabled,
`AuthContext.restoreSession` prompts Face ID / Touch ID / Android biometrics
before restoring a saved session on app launch, using `expo-local-authentication`.

## Dark mode

`ThemeContext` follows the system appearance by default; toggling "Dark
mode" in Profile settings switches to a manual light/dark preference
(persisted in AsyncStorage), with a one-tap way back to "follow system."

## Known stubs / next steps

- **Chat** persists messages locally via AsyncStorage (`src/api/messages.ts`)
  since `bulk-backend` has no messaging endpoints yet. The `ChatScreen`
  itself won't need to change once you add real ones — just swap the two
  functions in that file for `client.get/post('/messages...')` calls.
- **Forgot password** calls `/auth/forgot-password`, which doesn't exist on
  the backend yet; the screen still shows a reassuring "check your email"
  state either way (so the flow doesn't leak whether an email is
  registered) — add the real endpoint before shipping.
- **Push token upload** has no backend route to call yet (see above).
- Distance-based sorting/filtering expects a `distance` field on provider
  records, same as the web app — add it once the backend computes it from
  device geolocation.
