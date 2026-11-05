const pool = require('../config/db');
const { sendToUser, sendToUsers } = require('./pushNotifications');

/** Resolve the users.id behind a provider_profiles.id / customer_profiles.id pair. */
async function resolveUserIds(providerId, customerId) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT user_id FROM provider_profiles WHERE id = $1) AS provider_user_id,
       (SELECT user_id FROM customer_profiles WHERE id = $2) AS customer_user_id`,
    [providerId, customerId]
  );
  return rows[0] || {};
}

/**
 * New booking request created -> notify the provider.
 * @param {{ providerId, customerId, serviceTitle, customerName, bookingDate, bookingTime, bookingId }} details
 */
async function notifyNewBooking(details) {
  const { providerId, customerId, serviceTitle, customerName, bookingDate, bookingTime, bookingId } = details;
  const { provider_user_id } = await resolveUserIds(providerId, customerId);
  if (!provider_user_id) return;

  return sendToUser(provider_user_id, {
    title: 'New booking request',
    body: `${customerName} requested ${serviceTitle} on ${bookingDate} at ${bookingTime}`,
    data: { type: 'booking_created', bookingId },
  });
}

/**
 * Provider confirmed the booking -> notify the customer.
 * @param {{ providerId, customerId, serviceTitle, providerName, bookingDate, bookingTime, bookingId }} details
 */
async function notifyBookingConfirmed(details) {
  const { providerId, customerId, serviceTitle, providerName, bookingDate, bookingTime, bookingId } = details;
  const { customer_user_id } = await resolveUserIds(providerId, customerId);
  if (!customer_user_id) return;

  return sendToUser(customer_user_id, {
    title: 'Booking confirmed',
    body: `${providerName} confirmed your ${serviceTitle} booking for ${bookingDate} at ${bookingTime}`,
    data: { type: 'booking_confirmed', bookingId },
  });
}

/**
 * 1 hour before a confirmed booking -> remind both parties.
 * @param {{ providerId, customerId, serviceTitle, bookingTime, bookingId }} details
 */
async function notifyBookingReminder(details) {
  const { providerId, customerId, serviceTitle, bookingTime, bookingId } = details;
  const { provider_user_id, customer_user_id } = await resolveUserIds(providerId, customerId);
  const userIds = [provider_user_id, customer_user_id].filter(Boolean);
  if (userIds.length === 0) return;

  return sendToUsers(userIds, {
    title: 'Upcoming booking reminder',
    body: `${serviceTitle} starts at ${bookingTime} - see you soon!`,
    data: { type: 'booking_reminder', bookingId },
  });
}

/**
 * Booking cancelled (by either party) -> notify both.
 * @param {{ providerId, customerId, serviceTitle, bookingDate, bookingTime, bookingId, cancelledBy }} details
 */
async function notifyBookingCancelled(details) {
  const { providerId, customerId, serviceTitle, bookingDate, bookingTime, bookingId } = details;
  const { provider_user_id, customer_user_id } = await resolveUserIds(providerId, customerId);
  const userIds = [provider_user_id, customer_user_id].filter(Boolean);
  if (userIds.length === 0) return;

  return sendToUsers(userIds, {
    title: 'Booking cancelled',
    body: `${serviceTitle} on ${bookingDate} at ${bookingTime} has been cancelled`,
    data: { type: 'booking_cancelled', bookingId },
  });
}

module.exports = { notifyNewBooking, notifyBookingConfirmed, notifyBookingReminder, notifyBookingCancelled };
