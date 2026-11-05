const pool = require('../config/db');

/** Create a booking. */
async function createBooking({ serviceId, customerId, providerId, bookingDate, startTime, notes }) {
  const { rows } = await pool.query(
    `INSERT INTO bookings (service_id, customer_id, provider_id, booking_date, start_time, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [serviceId, customerId, providerId, bookingDate, startTime, notes || null]
  );
  return rows[0];
}

/** Get a booking by id, joined with service/provider/customer display info. */
async function findById(id) {
  const { rows } = await pool.query(
    `SELECT b.*,
            s.title AS service_title, s.price AS service_price,
            pp.business_name AS provider_name,
            cp.full_name AS customer_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN provider_profiles pp ON pp.id = b.provider_id
     JOIN customer_profiles cp ON cp.id = b.customer_id
     WHERE b.id = $1`,
    [id]
  );
  return rows[0];
}

/** List bookings for a customer, optionally filtered by status. */
async function listByCustomer(customerId, { status, limit = 20, offset = 0 } = {}) {
  const params = [customerId];
  let where = 'WHERE b.customer_id = $1';
  if (status) {
    params.push(status);
    where += ` AND b.status = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT b.*, s.title AS service_title, pp.business_name AS provider_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN provider_profiles pp ON pp.id = b.provider_id
     ${where}
     ORDER BY b.booking_date DESC, b.start_time DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/** List bookings for a provider, optionally filtered by status. */
async function listByProvider(providerId, { status, limit = 20, offset = 0 } = {}) {
  const params = [providerId];
  let where = 'WHERE b.provider_id = $1';
  if (status) {
    params.push(status);
    where += ` AND b.status = $${params.length}`;
  }
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT b.*, s.title AS service_title, cp.full_name AS customer_name
     FROM bookings b
     JOIN services s ON s.id = b.service_id
     JOIN customer_profiles cp ON cp.id = b.customer_id
     ${where}
     ORDER BY b.booking_date DESC, b.start_time DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/** Update a booking's status. */
async function updateStatus(id, status) {
  const { rows } = await pool.query(
    `UPDATE bookings SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id, status]
  );
  return rows[0];
}

module.exports = { createBooking, findById, listByCustomer, listByProvider, updateStatus };
