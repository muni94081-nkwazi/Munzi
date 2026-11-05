import type { Service, ProviderProfile, Booking } from './models';

export type AuthStackParamList = {
  Login: undefined;
  Signup: undefined;
  ForgotPassword: undefined;
};

export type CustomerTabParamList = {
  Home: undefined;
  Search: { category?: string; query?: string } | undefined;
  Messages: undefined;
  Bookings: undefined;
  Profile: undefined;
};

export type ProviderTabParamList = {
  Dashboard: undefined;
  ProviderBookings: undefined;
  Messages: undefined;
  Calendar: undefined;
  ProviderProfile: undefined;
};

// Shared screens are pushed on the root stack so either role can reach them
// (e.g. a provider viewing their own public profile the way a customer would).
export type RootStackParamList = {
  Auth: undefined;
  CustomerTabs: undefined;
  ProviderTabs: undefined;
  ProviderDetail: { providerId: string };
  BookingFlow: { service: Service; provider: ProviderProfile };
  BookingConfirmation: { booking: Booking; service: Service; provider: ProviderProfile };
  Chat: { otherUserId: string; withName: string };
  Messages: undefined;
  Reviews: { providerId: string; providerName: string; bookingToReview?: Booking };
};

// Augment React Navigation's global param list so `useNavigation()` and
// `navigation.navigate()` calls are type-checked without repeating generics
// at every call site.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
