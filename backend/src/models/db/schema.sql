-- =====================================================================
-- Bulk - Service Booking Platform
-- PostgreSQL schema
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ─── Users ──────────────────────────────────────────────────────────
-- Base auth table shared by both providers and customers.
CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(20) NOT NULL CHECK (role IN ('provider', 'customer')),
    is_active      BOOLEAN NOT NULL DEFAULT true,
    fcm_token      VARCHAR(255), -- Firebase Cloud Messaging device/browser token for push notifications
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Provider profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_profiles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_name  VARCHAR(255) NOT NULL,
    description    TEXT,
    phone          VARCHAR(30),
    address        VARCHAR(255),
    category       VARCHAR(100),
    avg_rating     NUMERIC(2,1) DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Customer profiles ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customer_profiles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    full_name      VARCHAR(255) NOT NULL,
    phone          VARCHAR(30),
    address        VARCHAR(255),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Services ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id      UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    title            VARCHAR(255) NOT NULL,
    description      TEXT,
    category         VARCHAR(100),
    price            NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
    is_active        BOOLEAN NOT NULL DEFAULT true,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Provider availability ──────────────────────────────────────────
-- Recurring weekly availability windows per provider.
CREATE TABLE IF NOT EXISTS availability (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id    UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    day_of_week    SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday .. 6=Saturday
    start_time     TIME NOT NULL,
    end_time       TIME NOT NULL,
    is_available   BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_time > start_time)
);

-- ─── Bookings ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id     UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    customer_id    UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    provider_id    UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    booking_date   DATE NOT NULL,
    start_time     TIME NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    notes          TEXT,
    reminder_sent  BOOLEAN NOT NULL DEFAULT false, -- set true once the 1-hour-before push has gone out
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Reviews ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id     UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    customer_id    UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    provider_id    UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_services_provider ON services(provider_id);
CREATE INDEX IF NOT EXISTS idx_availability_provider ON availability(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service ON bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_reviews_provider ON reviews(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_reminder_scan ON bookings(booking_date, status, reminder_sent);

-- Prevents two non-cancelled bookings from ever occupying the same
-- provider/date/time slot, even under concurrent requests - the last line
-- of defense behind the transactional check in bookingController.createBooking.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_provider_slot
    ON bookings (provider_id, booking_date, start_time)
    WHERE status IN ('pending', 'confirmed');

-- =====================================================================
-- MESSAGES (real-time chat between a customer and a provider)
-- sender_id/receiver_id reference users directly (not provider/customer
-- profiles) since either party can message the other regardless of role.
-- =====================================================================
CREATE TABLE IF NOT EXISTS messages (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message        TEXT NOT NULL,
    attachment_url TEXT, -- optional image/file attachment
    read           BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (sender_id != receiver_id)
);

-- Powers "chat history with this person" (both directions) ordered by time.
CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at);

-- Powers "list all my conversations" and unread-count lookups.
CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread ON messages (receiver_id, read);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id);

-- ─── Password reset tokens ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token          VARCHAR(64) UNIQUE NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    used           BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens(user_id);
