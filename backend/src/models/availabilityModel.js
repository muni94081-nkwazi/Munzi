const pool = require('../config/db');

/** Create an availability window for a provider. */
async function createAvailability({ providerId, dayOfWeek, startTime, endTime, isAvailable = true }) {
  const { rows } = await pool.query(
    `INSERT INTO availability (provider_id, day_of_week, start_time, end_time, is_available)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [providerId, dayOfWeek, startTime, endTime, isAvailable]
  );
  return rows[0];
}

/** List all availability windows for a provider, ordered by day/time. */
async function listByProvider(providerId) {
  const { rows } = await pool.query(
    `SELECT * FROM availability WHERE provider_id = $1
     ORDER BY day_of_week ASC, start_time ASC`,
    [providerId]
  );
  return rows;
}

/** Get a single availability row by id. */
async function findById(id) {
  const { rows } = await pool.query(`SELECT * FROM availability WHERE id = $1`, [id]);
  return rows[0];
}

/** Update an availability window. Only fields present in `fields` are modified. */
async function updateAvailability(id, fields) {
  const allowed = ['day_of_week', 'start_time', 'end_time', 'is_available'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(id);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE availability SET ${setClause} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return rows[0];
}

/** Delete an availability window. */
async function deleteAvailability(id) {
  const { rows } = await pool.query(`DELETE FROM availability WHERE id = $1 RETURNING id`, [id]);
  return rows[0];
}

module.exports = { createAvailability, listByProvider, findById, updateAvailability, deleteAvailability };
