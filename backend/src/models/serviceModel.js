const pool = require('../config/db');

/** Create a new service under a provider. */
async function createService({ providerId, title, description, category, price, durationMinutes }) {
  const { rows } = await pool.query(
    `INSERT INTO services (provider_id, title, description, category, price, duration_minutes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [providerId, title, description || null, category || null, price, durationMinutes]
  );
  return rows[0];
}

/** Get a single service by id. */
async function findById(id) {
  const { rows } = await pool.query(`SELECT * FROM services WHERE id = $1`, [id]);
  return rows[0];
}

/** List services with optional filters (provider, category, active only) + pagination. */
async function listServices({ providerId, category, activeOnly = true, limit = 20, offset = 0 }) {
  const conditions = [];
  const params = [];

  if (providerId) {
    params.push(providerId);
    conditions.push(`provider_id = $${params.length}`);
  }
  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (activeOnly) {
    conditions.push(`is_active = true`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT * FROM services ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/** Update a service. Only fields present in `fields` are modified. */
async function updateService(id, fields) {
  const allowed = ['title', 'description', 'category', 'price', 'duration_minutes', 'is_active'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findById(id);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE services
     SET ${setClause}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, ...values]
  );
  return rows[0];
}

/** Delete a service by id. Returns the deleted row (or undefined if not found). */
async function deleteService(id) {
  const { rows } = await pool.query(`DELETE FROM services WHERE id = $1 RETURNING id`, [id]);
  return rows[0];
}

module.exports = { createService, findById, listServices, updateService, deleteService };
