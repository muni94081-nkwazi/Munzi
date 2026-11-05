# Bulk — Frontend

React + Tailwind CSS frontend for the Bulk service booking platform. Pairs with
the `bulk-backend` Express/PostgreSQL API.

## Stack

- React 18 + Vite
- React Router v6
- Axios (with a JWT-attaching interceptor)
- Tailwind CSS
- Context API for auth + toast notifications (no Redux needed at this scale)

## Setup

```bash
npm install
cp .env.example .env     # point VITE_API_BASE_URL at your backend
npm run dev
```

Build for production:

```bash
npm run build
npm run preview
```

## Project structure

```
src/
  api/            # one file per resource: auth, providers, services, bookings, availability, reviews
  components/     # shared UI: Navbar, ProviderCard, Calendar, TimeSlotPicker, common.jsx (spinner/badge/modal/etc.)
  context/        # AuthContext (session + profile), ToastContext (notifications)
  pages/          # one file per route (see below)
  utils/          # constants, validators, formatters
  App.jsx         # route definitions
  main.jsx        # entry point, wraps App in providers
```

## Pages / routes

| Route                  | Page                        | Access              |
|-------------------------|-----------------------------|----------------------|
| `/`                     | Home (search, categories, featured providers) | Public |
| `/signup`, `/login`     | Auth                        | Public |
| `/provider/setup`       | Provider profile setup (business info → services → availability) | Provider |
| `/customer/setup`       | Customer profile setup      | Customer |
| `/search`               | Search results (filters + sort) | Public |
| `/providers/:id`        | Provider detail (services, availability, reviews, book now) | Public |
| `/book/:serviceId`      | Booking flow (date → time → notes → confirm) | Customer |
| `/booking/confirmed`    | Booking success page        | Customer |
| `/bookings`             | My Bookings (tabs: upcoming/past/cancelled) | Any logged-in user |
| `/provider/dashboard`   | Provider dashboard (stats, upcoming bookings, quick actions) | Provider |
| `/profile`              | Profile, password, settings | Any logged-in user |

## Design notes

The visual identity leans into the platform's name: cards and confirmations
use a "ticket stub" motif (a perforated top edge + status badges styled like
rubber stamps) as a nod to a market-stall receipt. Palette is deep navy (`ink`)
+ marigold accent + warm linen background, with Space Grotesk for headings,
Inter for body text, and IBM Plex Mono for prices/times/stats — so numbers
that matter (money, time, ratings) always read as data, not prose.

## Notes on the current build

- Every page uses real `axios` calls against the endpoints documented in the
  `bulk-backend` README — there's no mock data layer.
- Image upload (provider setup) currently only previews the file locally;
  wire it to a real upload endpoint (e.g. S3/Cloudinary) before shipping.
- "Change password" and the customer payment-method step submit locally for
  now — connect them to real endpoints when those exist on the backend.
- Distance-based sort/filtering expects a `distance` field on provider
  records; add that once the backend computes it from user geolocation.
