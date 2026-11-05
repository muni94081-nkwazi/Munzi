const pool = require('../config/db');

/** Create a review tied to a completed booking. */
async function createReview({ bookingId, customerId, providerId, rating, comment }) {
  const { rows } = await pool.query(
    `INSERT INTO reviews (booking_id, customer_id, provider_id, rating, comment)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [bookingId, customerId, providerId, rating, comment || null]
  );
  return rows[0];
}

/** Check whether a review already exists for a booking. */
async function findByBookingId(bookingId) {
  const { rows } = await pool.query(`SELECT * FROM reviews WHERE booking_id = $1`, [bookingId]);
  return rows[0];
}

/** List all reviews for a given provider, most recent first. */
async function listByProvider(providerId, { limit = 20, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT r.*, cp.full_name AS customer_name
     FROM reviews r
     JOIN customer_profiles cp ON cp.id = r.customer_id
     WHERE r.provider_id = $1
     ORDER BY r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [providerId, limit, offset]
  );
  return rows;
}

module.exports = { createReview, findByBookingId, listByProvider };
