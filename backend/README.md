# Bulk — Service Booking Platform API

A Node.js + Express + PostgreSQL backend for a service booking platform,
supporting two roles: **providers** (who offer services) and **customers**
(who book them).

## Stack

- Node.js + Express
- PostgreSQL (raw `pg` driver, no ORM)
- JWT authentication (`jsonwebtoken`)
- Password hashing (`bcryptjs`)
- Request validation (`joi`)
- Security/logging middleware (`helmet`, `cors`, `morgan`)

## Project structure

```
src/
  config/        # db.js (pg pool), jwt.js
  models/        # SQL query modules + db/schema.sql + db/migrate.js
  controllers/   # business logic
  routes/        # Express route definitions
  middleware/    # auth (JWT), roleCheck, validate (Joi), errorHandler
  utils/         # AppError, asyncHandler, token helpers
  app.js         # Express app assembly
  server.js      # entrypoint
```

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create a PostgreSQL database and user, e.g.:
   ```sql
   CREATE DATABASE bulk_db;
   CREATE USER bulk_user WITH PASSWORD 'bulk_password';
   GRANT ALL PRIVILEGES ON DATABASE bulk_db TO bulk_user;
   ```

3. Copy the sample env file and fill in your own values:
   ```bash
   cp .env.example .env
   ```
   Make sure to set a strong, random `JWT_SECRET`.

4. Run the migration to create all tables:
   ```bash
   npm run migrate
   ```

5. Start the server:
   ```bash
   npm run dev      # with nodemon
   # or
   npm start
   ```

The API will be available at `http://localhost:5000` (or your configured `PORT`).
A health check is available at `GET /health`.

## Authentication

All private routes expect a header:

```
Authorization: Bearer <token>
```

The token is returned from `POST /api/auth/signup` and `POST /api/auth/login`.

## API Reference

### Auth — `/api/auth`
| Method | Endpoint       | Access  | Description |
|--------|----------------|---------|-------------|
| POST   | `/signup`      | Public  | Register as `provider` or `customer`. Body varies by role (see below). |
| POST   | `/login`       | Public  | `{ email, password }` → returns JWT. |
| GET    | `/me`          | Private | Current user + their profile. |

**Signup body (provider):**
```json
{
  "email": "jane@bulk.ug",
  "password": "SuperSecret123",
  "role": "provider",
  "businessName": "Jane's Salon",
  "category": "beauty",
  "phone": "+256700000000",
  "address": "Kampala, UG",
  "description": "Hair & beauty services"
}
```

**Signup body (customer):**
```json
{
  "email": "amos@bulk.ug",
  "password": "SuperSecret123",
  "role": "customer",
  "fullName": "Amos Okello",
  "phone": "+256700000001",
  "address": "Kampala, UG"
}
```

### Profiles
| Method | Endpoint               | Access             | Description |
|--------|------------------------|--------------------|-------------|
| GET    | `/api/providers`       | Public             | List providers. Query: `category`, `page`, `limit`. |
| GET    | `/api/providers/:id`   | Public             | View a provider's public profile. |
| PATCH  | `/api/providers/me`    | Private (provider) | Update own provider profile. |
| PATCH  | `/api/customers/me`    | Private (customer) | Update own customer profile. |

### Services — `/api/services`
| Method | Endpoint | Access                      | Description |
|--------|----------|-----------------------------|-------------|
| GET    | `/`      | Public                      | List services. Query: `providerId`, `category`, `page`, `limit`. |
| GET    | `/:id`   | Public                      | View a single service. |
| POST   | `/`      | Private (provider)          | Create a service. |
| PATCH  | `/:id`   | Private (provider, owner)   | Update a service. |
| DELETE | `/:id`   | Private (provider, owner)   | Delete a service. |

**Create/update body:**
```json
{ "title": "Haircut", "description": "Classic cut", "category": "beauty", "price": 15000, "durationMinutes": 45 }
```

### Availability — `/api/availability`
| Method | Endpoint                    | Access                    | Description |
|--------|-----------------------------|---------------------------|-------------|
| GET    | `/me`                       | Private (provider)        | List own availability windows. |
| GET    | `/provider/:providerId`     | Public                    | List a provider's availability. |
| POST   | `/`                         | Private (provider)         | Add a weekly window. |
| PATCH  | `/:id`                      | Private (provider, owner)  | Update a window. |
| DELETE | `/:id`                      | Private (provider, owner)  | Delete a window. |

**Create body:**
```json
{ "dayOfWeek": 1, "startTime": "09:00", "endTime": "17:00", "isAvailable": true }
```
`dayOfWeek`: 0 = Sunday … 6 = Saturday.

### Bookings — `/api/bookings`
| Method | Endpoint       | Access                | Description |
|--------|----------------|-----------------------|-------------|
| GET    | `/me`          | Private               | List own bookings (as customer or provider). Query: `status`. |
| GET    | `/:id`         | Private (participant) | View a single booking. |
| POST   | `/`            | Private (customer)    | Create a booking. |
| PATCH  | `/:id/status`  | Private (participant) | Update booking status. |

**Create body:**
```json
{ "serviceId": "uuid", "bookingDate": "2026-08-10", "startTime": "10:00", "notes": "First visit" }
```

**Status transitions:**
```
pending    → confirmed | cancelled
confirmed  → completed | cancelled
completed  → (terminal)
cancelled  → (terminal)
```

### Reviews — `/api/reviews`
| Method | Endpoint               | Access              | Description |
|--------|------------------------|---------------------|-------------|
| GET    | `/provider/:providerId`| Public              | List a provider's reviews. |
| POST   | `/`                    | Private (customer)  | Review a completed booking (one review per booking). |

**Create body:**
```json
{ "bookingId": "uuid", "rating": 5, "comment": "Great service!" }
```

## Error format

All errors are returned as:
```json
{ "success": false, "message": "Description of what went wrong" }
```

## Notes

- Passwords are hashed with bcrypt (cost factor 12) — never stored in plaintext.
- All monetary values are stored as `NUMERIC(10,2)`.
- Foreign keys enforce referential integrity (e.g. a service can't be deleted
  out from under an existing booking — `ON DELETE RESTRICT`).
- This is a self-contained starting point: add rate limiting, refresh tokens,
  email verification, and a real test suite before production use.
