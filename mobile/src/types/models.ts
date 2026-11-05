export type Role = 'provider' | 'customer';

export type User = {
  id: string;
  email: string;
  role: Role;
};

export type ProviderProfile = {
  id: string;
  user_id: string;
  business_name: string;
  description?: string;
  category?: string;
  location?: string;
  hourly_rate?: number;
  rating?: number;
  is_verified?: boolean;
  imageUrl?: string;
};

export type CustomerProfile = {
  id: string;
  user_id: string;
  full_name: string;
  phone?: string;
  address?: string;
};

export type Service = {
  id: string;
  provider_id: string;
  title: string;
  description?: string;
  category?: string;
  price: number;
  duration_minutes: number;
  is_active: boolean;
};

export type AvailabilityWindow = {
  id: string;
  provider_id: string;
  day_of_week: number; // 0=Sunday .. 6=Saturday
  start_time: string; // "HH:mm:ss"
  end_time: string;
  is_available: boolean;
};

export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

export type Booking = {
  id: string;
  service_id: string;
  customer_id: string;
  provider_id: string;
  booking_date: string; // "YYYY-MM-DD"
  start_time: string; // "HH:mm"
  status: BookingStatus;
  notes?: string;
  service_title?: string;
  service_price?: number;
  provider_name?: string;
  customer_name?: string;
};

export type Review = {
  id: string;
  booking_id: string;
  customer_id: string;
  provider_id: string;
  rating: number;
  comment?: string;
  created_at: string;
  customer_name?: string;
};

export type ChatMessage = {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  attachment_url?: string;
  read: boolean;
  created_at: string;
};
