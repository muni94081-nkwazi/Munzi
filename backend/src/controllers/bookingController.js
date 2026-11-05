const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const pool = require('../config/db');
const bookingModel = require('../models/bookingModel');
const serviceModel = require('../models/serviceModel');
const customerProfileModel = require('../models/customerProfileModel');
const providerProfileModel = require('../models/providerProfileModel');
const { sendBookingRequestEmail } = require('../utils/mailer');
const {
  notifyNewBooking,
  notifyBookingConfirmed,
  notifyBookingCancelled,
} = require('../utils/bookingNotifications');

/**
 * Valid status transitions. Prevents e.g. moving a cancelled booking back to pending.
 */
const ALLOWED_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/**
 * @route   POST /api/bookings
 * @desc    Create a booking request for a service. Validates that the
 *          service belongs to the given provider, that the provider is
 *          actually available at the requested date/time, and that the
 *          slot isn't already taken - then creates the booking inside a
 *          transaction and emails the provider a heads-up.
 * @access  Private (customer)
 * @body    { providerId, serviceId, bookingDate ("YYYY-MM-DD"),
 *            bookingTime ("HH:mm"), notes? }
 *
 * Status codes:
 *   201 - booking created
 *   400 - invalid input (bad shape, past date/time, or outside provider's
 *         working hours for that day)
 *   401 - not authenticated                      (handled by `protect`)
 *   403 - authenticated but not a customer        (handled by `restrictTo`)
 *   404 - provider or service not found / mismatched
 *   409 - that exact slot is already booked
 *   500 - unexpected server/database error
 */
const createBooking = asyncHandler(async (req, res) => {
  const { providerId, serviceId, bookingDate, bookingTime, notes } = req.body;

  // ── 1. Resolve the customer profile for the authenticated user ──────
  // `protect` already guarantees 401 for missing/invalid tokens and
  // `restrictTo('customer')` already guarantees 403 for non-customers,
  // so by this point req.user.role === 'customer'.
  const customerProfile = await customerProfileModel.findByUserId(req.user.id);
  if (!customerProfile) throw new AppError('Customer profile not found.', 404);

  // ── 2. Provider must exist ───────────────────────────────────────────
  const provider = await providerProfileModel.findWithUserEmail(providerId);
  if (!provider) throw new AppError('Provider not found.', 404);

  // ── 3. Service must exist, be active, and belong to that provider ───
  const service = await serviceModel.findById(serviceId);
  if (!service || !service.is_active) {
    throw new AppError('Service not found or is no longer available.', 404);
  }
  if (service.provider_id !== providerId) {
    throw new AppError('This service is not offered by the specified provider.', 404);
  }

  // ── 4. Booking date/time must be in the future ───────────────────────
  const requestedAt = new Date(`${bookingDate}T${bookingTime}:00`);
  if (Number.isNaN(requestedAt.getTime()) || requestedAt <= new Date()) {
    throw new AppError('Booking date and time must be in the future.', 400);
  }

  // ── 5. Run availability + conflict check + insert as one transaction ─
  const client = await pool.connect();
  let booking;
  try {
    await client.query('BEGIN');

    // 5a. Provider must have a matching availability window on that day.
    //     day_of_week is derived in SQL (not JS) to avoid any server/DB
    //     timezone mismatch when computing "what day of the week is this".
    const availabilityResult = await client.query(
      `SELECT id FROM availability
       WHERE provider_id = $1
         AND day_of_week = EXTRACT(DOW FROM $2::date)
         AND is_available = true
         AND start_time <= $3::time
         AND end_time > $3::time
       LIMIT 1`,
      [providerId, bookingDate, bookingTime]
    );
    if (availabilityResult.rows.length === 0) {
      throw new AppError('Provider is not available at the requested date and time.', 400);
    }

    // 5b. The exact slot must not already be booked. `FOR UPDATE` locks any
    //     matching row for the rest of this transaction, and the query is
    //     re-checked below after the lock is acquired, so two simultaneous
    //     requests for the same slot can't both pass this check - the
    //     second one blocks here until the first commits, then sees the
    //     row it just inserted. A partial unique index on
    //     (provider_id, booking_date, start_time) WHERE status IN
    //     ('pending','confirmed') backs this up at the database level too.
    const conflictResult = await client.query(
      `SELECT id FROM bookings
       WHERE provider_id = $1 AND booking_date = $2 AND start_time = $3
         AND status IN ('pending', 'confirmed')
       FOR UPDATE`,
      [providerId, bookingDate, bookingTime]
    );
    if (conflictResult.rows.length > 0) {
      throw new AppError('This time slot has already been booked.', 409);
    }

    // 5c. Create the booking.
    const insertResult = await client.query(
      `INSERT INTO bookings (service_id, customer_id, provider_id, booking_date, start_time, status, notes)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       RETURNING *`,
      [serviceId, customerProfile.id, providerId, bookingDate, bookingTime, notes || null]
    );
    booking = insertResult.rows[0];

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // Fall back to the DB-level unique constraint if two requests raced
    // past the application-level check above at nearly the same instant.
    if (err.code === '23505') {
      throw new AppError('This time slot has already been booked.', 409);
    }
    throw err;
  } finally {
    client.release();
  }

  // ── 6. Notify the provider by email + push (both best-effort, never block the response) ─
  const emailResult = await sendBookingRequestEmail({
    providerEmail: provider.user_email,
    providerName: provider.business_name,
    customerName: customerProfile.full_name,
    serviceTitle: service.title,
    bookingDate,
    bookingTime,
    notes,
  }).catch((err) => {
    console.error('Unexpected error sending booking notification email:', err);
    return { sent: false, reason: 'unexpected_error' };
  });

  const pushResult = await notifyNewBooking({
    providerId,
    customerId: customerProfile.id,
    serviceTitle: service.title,
    customerName: customerProfile.full_name,
    bookingDate,
    bookingTime,
    bookingId: booking.id,
  }).catch((err) => {
    console.error('Unexpected error sending new-booking push notification:', err);
    return { sent: false, reason: 'unexpected_error' };
  });

  res.status(201).json({
    success: true,
    message: 'Booking request created successfully.',
    data: {
      ...booking,
      service_title: service.title,
      provider_name: provider.business_name,
      notificationEmailSent: emailResult.sent,
      notificationPushSent: !!pushResult?.sent,
    },
  });
});

/**
 * @route   GET /api/bookings/:id
 * @desc    Get a single booking. Only the customer or provider involved may view it.
 * @access  Private
 */
const getBooking = asyncHandler(async (req, res) => {
  const booking = await bookingModel.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found.', 404);

  await assertParticipant(req.user, booking);
  res.status(200).json({ success: true, data: booking });
});

/**
 * @route   GET /api/bookings/me
 * @desc    List the logged-in user's bookings (as customer or provider, based on role).
 * @access  Private
 * @query   status?, page?, limit?
 */
const listMyBookings = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let bookings;
  if (req.user.role === 'customer') {
    const customerProfile = await customerProfileModel.findByUserId(req.user.id);
    if (!customerProfile) throw new AppError('Customer profile not found.', 404);
    bookings = await bookingModel.listByCustomer(customerProfile.id, { status, limit: Number(limit), offset });
  } else {
    const providerProfile = await providerProfileModel.findByUserId(req.user.id);
    if (!providerProfile) throw new AppError('Provider profile not found.', 404);
    bookings = await bookingModel.listByProvider(providerProfile.id, { status, limit: Number(limit), offset });
  }

  res.status(200).json({ success: true, data: bookings });
});

/**
 * @route   PATCH /api/bookings/:id/status
 * @desc    Update a booking's status following the allowed state machine:
 *          pending -> confirmed | cancelled
 *          confirmed -> completed | cancelled
 *          Providers typically confirm/complete; either party may cancel.
 * @access  Private (participant only)
 * @body    { status: 'pending' | 'confirmed' | 'completed' | 'cancelled' }
 */
const updateBookingStatus = asyncHandler(async (req, res) => {
  const booking = await bookingModel.findById(req.params.id);
  if (!booking) throw new AppError('Booking not found.', 404);

  await assertParticipant(req.user, booking);

  const { status: nextStatus } = req.body;
  const allowedNext = ALLOWED_TRANSITIONS[booking.status] || [];

  if (!allowedNext.includes(nextStatus)) {
    throw new AppError(
      `Cannot transition booking from '${booking.status}' to '${nextStatus}'.`,
      400
    );
  }

  const updated = await bookingModel.updateStatus(req.params.id, nextStatus);

  // Best-effort push notifications - never block the response on delivery.
  if (nextStatus === 'confirmed') {
    await notifyBookingConfirmed({
      providerId: booking.provider_id,
      customerId: booking.customer_id,
      serviceTitle: booking.service_title,
      providerName: booking.provider_name,
      bookingDate: booking.booking_date,
      bookingTime: booking.start_time,
      bookingId: booking.id,
    }).catch((err) => console.error('Unexpected error sending booking-confirmed push:', err));
  } else if (nextStatus === 'cancelled') {
    await notifyBookingCancelled({
      providerId: booking.provider_id,
      customerId: booking.customer_id,
      serviceTitle: booking.service_title,
      bookingDate: booking.booking_date,
      bookingTime: booking.start_time,
      bookingId: booking.id,
    }).catch((err) => console.error('Unexpected error sending booking-cancelled push:', err));
  }

  res.status(200).json({ success: true, data: updated });
});

/**
 * Ensures the requesting user is either the customer or provider on the booking.
 * @param {{id: string, role: string}} user
 * @param {object} booking - row returned from bookingModel.findById (has customer_id/provider_id
 *                            referencing profile ids, so we resolve via user's profile).
 */
async function assertParticipant(user, booking) {
  if (user.role === 'customer') {
    const profile = await customerProfileModel.findByUserId(user.id);
    if (!profile || profile.id !== booking.customer_id) {
      throw new AppError('You do not have permission to access this booking.', 403);
    }
  } else if (user.role === 'provider') {
    const profile = await providerProfileModel.findByUserId(user.id);
    if (!profile || profile.id !== booking.provider_id) {
      throw new AppError('You do not have permission to access this booking.', 403);
    }
  } else {
    throw new AppError('You do not have permission to access this booking.', 403);
  }
}

module.exports = { createBooking, getBooking, listMyBookings, updateBookingStatus };
