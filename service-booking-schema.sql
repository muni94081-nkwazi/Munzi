-- =====================================================================
-- Service Booking Platform — PostgreSQL Schema
-- UUID primary keys, timestamptz timestamps
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- for gen_random_uuid()

-- =====================================================================
-- 1. USERS
-- Base account table shared by providers and customers.
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          VARCHAR(255) UNIQUE NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(20) NOT NULL CHECK (role IN ('provider', 'customer', 'admin')),
    full_name      VARCHAR(255) NOT NULL,
    phone          VARCHAR(30),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 2. PROVIDER_PROFILES
-- Extended data for users with role = 'provider'.
-- availability is stored as JSONB, e.g.:
-- { "mon": ["09:00-12:00","14:00-18:00"], "tue": ["09:00-17:00"], ... }
-- =====================================================================
CREATE TABLE IF NOT EXISTS provider_profiles (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_name  VARCHAR(255) NOT NULL,
    description    TEXT,
    category       VARCHAR(100),
    location       VARCHAR(255),
    hourly_rate    NUMERIC(10,2) CHECK (hourly_rate >= 0),
    availability   JSONB DEFAULT '{}'::jsonb,
    rating         NUMERIC(2,1) DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
    is_verified    BOOLEAN NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 3. CUSTOMER_PROFILES
-- Extended data for users with role = 'customer'.
-- =====================================================================
CREATE TABLE IF NOT EXISTS customer_profiles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    address            VARCHAR(255),
    preferred_contact  VARCHAR(20) CHECK (preferred_contact IN ('email', 'phone', 'sms')),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 4. SERVICES
-- Services offered by a provider.
-- =====================================================================
CREATE TABLE IF NOT EXISTS services (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_id    UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    title          VARCHAR(255) NOT NULL,
    description    TEXT,
    price          NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    duration       INTEGER NOT NULL CHECK (duration > 0), -- minutes
    category       VARCHAR(100),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 5. BOOKINGS
-- =====================================================================
CREATE TABLE IF NOT EXISTS bookings (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id    UUID NOT NULL REFERENCES customer_profiles(id) ON DELETE CASCADE,
    provider_id    UUID NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
    service_id     UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    booking_date   DATE NOT NULL,
    booking_time   TIME NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled')),
    notes          TEXT,
    total_price    NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- 6. REVIEWS
-- reviewer_id references users directly (the customer who left it),
-- one review per booking.
-- =====================================================================
CREATE TABLE IF NOT EXISTS reviews (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id     UUID UNIQUE NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    reviewer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment        TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES — speed up the most common lookups/filters
-- =====================================================================
CREATE INDEX IF NOT EXISTS idx_provider_profiles_user_id   ON provider_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_profiles_user_id   ON customer_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_category  ON provider_profiles(category);
CREATE INDEX IF NOT EXISTS idx_provider_profiles_location  ON provider_profiles(location);

CREATE INDEX IF NOT EXISTS idx_services_provider_id        ON services(provider_id);
CREATE INDEX IF NOT EXISTS idx_services_category           ON services(category);

CREATE INDEX IF NOT EXISTS idx_bookings_customer_id        ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_provider_id         ON bookings(provider_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_id          ON bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status              ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_date        ON bookings(booking_date);
-- Composite index: most provider-schedule queries filter by provider + date together
CREATE INDEX IF NOT EXISTS idx_bookings_provider_date       ON bookings(provider_id, booking_date);

CREATE INDEX IF NOT EXISTS idx_reviews_booking_id           ON reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id          ON reviews(reviewer_id);


-- =====================================================================
-- SAMPLE DATA
-- =====================================================================

-- ─── Users ───────────────────────────────────────────────────────────
INSERT INTO users (id, email, password_hash, role, full_name, phone) VALUES
('11111111-1111-1111-1111-111111111111', 'jane.provider@bulk.ug', '$2a$12$examplehashedpassword1', 'provider', 'Jane Nakato', '+256700111111'),
('22222222-2222-2222-2222-222222222222', 'moses.provider@bulk.ug', '$2a$12$examplehashedpassword2', 'provider', 'Moses Okiror', '+256700222222'),
('33333333-3333-3333-3333-333333333333', 'amos.customer@bulk.ug', '$2a$12$examplehashedpassword3', 'customer', 'Amos Kintu', '+256700333333'),
('44444444-4444-4444-4444-444444444444', 'grace.customer@bulk.ug', '$2a$12$examplehashedpassword4', 'customer', 'Grace Nabirye', '+256700444444')
ON CONFLICT (id) DO NOTHING;

-- ─── Provider profiles ───────────────────────────────────────────────
INSERT INTO provider_profiles (id, user_id, business_name, description, category, location, hourly_rate, availability, rating, is_verified) VALUES
('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
 'Jane''s Beauty Studio', 'Hair, makeup and skincare services', 'beauty', 'Kampala, Kololo', 40000,
 '{"mon": ["09:00-17:00"], "tue": ["09:00-17:00"], "wed": ["09:00-17:00"], "thu": ["09:00-17:00"], "fri": ["09:00-15:00"]}'::jsonb,
 4.8, true),
('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
 'Okiror Repairs', 'Home appliance and electrical repair', 'home-repair', 'Kampala, Ntinda', 25000,
 '{"mon": ["08:00-18:00"], "tue": ["08:00-18:00"], "wed": ["08:00-18:00"], "sat": ["08:00-13:00"]}'::jsonb,
 4.5, true)
ON CONFLICT (id) DO NOTHING;

-- ─── Customer profiles ───────────────────────────────────────────────
INSERT INTO customer_profiles (id, user_id, address, preferred_contact) VALUES
('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Bugolobi, Kampala', 'phone'),
('bbbbbbbb-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'Muyenga, Kampala', 'email')
ON CONFLICT (id) DO NOTHING;

-- ─── Services ────────────────────────────────────────────────────────
INSERT INTO services (id, provider_id, title, description, price, duration, category) VALUES
('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
 'Haircut & Styling', 'Classic cut with wash and blow-dry', 30000, 60, 'beauty'),
('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
 'Full Makeup', 'Event-ready makeup application', 80000, 90, 'beauty'),
('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000002',
 'Fridge Repair', 'Diagnosis and repair of refrigerators', 50000, 120, 'home-repair')
ON CONFLICT (id) DO NOTHING;

-- ─── Bookings ────────────────────────────────────────────────────────
INSERT INTO bookings (id, customer_id, provider_id, service_id, booking_date, booking_time, status, notes, total_price) VALUES
('dddddddd-0000-0000-0000-000000000001',
 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
 'cccccccc-0000-0000-0000-000000000001', '2026-08-10', '10:00', 'completed', 'First-time client', 30000),
('dddddddd-0000-0000-0000-000000000002',
 'bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
 'cccccccc-0000-0000-0000-000000000003', '2026-08-12', '14:00', 'confirmed', 'Fridge not cooling', 50000),
('dddddddd-0000-0000-0000-000000000003',
 'bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
 'cccccccc-0000-0000-0000-000000000002', '2026-08-20', '11:00', 'pending', 'Wedding guest makeup', 80000)
ON CONFLICT (id) DO NOTHING;

-- ─── Reviews ─────────────────────────────────────────────────────────
INSERT INTO reviews (id, booking_id, reviewer_id, rating, comment) VALUES
('eeeeeeee-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001',
 '33333333-3333-3333-3333-333333333333', 5, 'Excellent haircut, very professional!')
ON CONFLICT (id) DO NOTHING;


-- =====================================================================
-- USEFUL QUERIES
-- =====================================================================

-- ─── 1. Get all bookings for a given provider (most recent first) ────
-- Replace the provider_id literal with a real UUID at call time.
SELECT
    b.id            AS booking_id,
    b.booking_date,
    b.booking_time,
    b.status,
    b.total_price,
    s.title         AS service_title,
    u.full_name     AS customer_name,
    u.phone         AS customer_phone
FROM bookings b
JOIN services s           ON s.id = b.service_id
JOIN customer_profiles cp ON cp.id = b.customer_id
JOIN users u               ON u.id = cp.user_id
WHERE b.provider_id = 'aaaaaaaa-0000-0000-0000-000000000001'
ORDER BY b.booking_date DESC, b.booking_time DESC;

-- ─── 2. Get a customer's full booking history, with reviews if left ──
SELECT
    b.id            AS booking_id,
    b.booking_date,
    b.booking_time,
    b.status,
    b.total_price,
    s.title         AS service_title,
    pp.business_name AS provider_name,
    r.rating        AS review_rating,
    r.comment       AS review_comment
FROM bookings b
JOIN services s            ON s.id = b.service_id
JOIN provider_profiles pp  ON pp.id = b.provider_id
LEFT JOIN reviews r        ON r.booking_id = b.id
WHERE b.customer_id = 'bbbbbbbb-0000-0000-0000-000000000001'
ORDER BY b.booking_date DESC;

-- ─── 3. Find available/verified providers by category and location ───
-- "Available" here means verified and not fully booked on the target date;
-- adjust the HAVING threshold to your own definition of "fully booked".
SELECT
    pp.id,
    pp.business_name,
    pp.category,
    pp.location,
    pp.hourly_rate,
    pp.rating,
    pp.availability
FROM provider_profiles pp
WHERE pp.category = 'beauty'
  AND pp.location ILIKE '%Kampala%'
  AND pp.is_verified = true
  AND pp.id NOT IN (
      SELECT b.provider_id
      FROM bookings b
      WHERE b.booking_date = '2026-08-20'
        AND b.status IN ('pending', 'confirmed')
      GROUP BY b.provider_id
      HAVING COUNT(*) >= 8  -- example cap: 8 bookings/day = fully booked
  )
ORDER BY pp.rating DESC;

-- ─── 4. Provider's upcoming (future, non-cancelled) bookings ──────────
SELECT b.*, s.title AS service_title
FROM bookings b
JOIN services s ON s.id = b.service_id
WHERE b.provider_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  AND b.booking_date >= CURRENT_DATE
  AND b.status != 'cancelled'
ORDER BY b.booking_date, b.booking_time;

-- ─── 5. Average rating and total completed bookings per provider ─────
SELECT
    pp.id,
    pp.business_name,
    COUNT(b.id) FILTER (WHERE b.status = 'completed') AS completed_bookings,
    ROUND(AVG(r.rating)::numeric, 1)                  AS avg_review_rating
FROM provider_profiles pp
LEFT JOIN bookings b ON b.provider_id = pp.id
LEFT JOIN reviews r  ON r.booking_id = b.id
GROUP BY pp.id, pp.business_name
ORDER BY avg_review_rating DESC NULLS LAST;
