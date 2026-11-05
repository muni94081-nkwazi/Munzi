const pool = require('../config/db');

/** Create a provider profile row linked to a user. */
async function createProviderProfile({ userId, businessName, description, phone, address, category }) {
  const { rows } = await pool.query(
    `INSERT INTO provider_profiles (user_id, business_name, description, phone, address, category)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, businessName, description || null, phone || null, address || null, category || null]
  );
  return rows[0];
}

/** Find provider profile by the underlying user_id. */
async function findByUserId(userId) {
  const { rows } = await pool.query(`SELECT * FROM provider_profiles WHERE user_id = $1`, [userId]);
  return rows[0];
}

/** Find provider profile by its own id (provider_profiles.id). */
async function findById(id) {
  const { rows } = await pool.query(`SELECT * FROM provider_profiles WHERE id = $1`, [id]);
  return rows[0];
}

/** List all providers, optionally filtered by category, with pagination. */
async function listProviders({ category, limit = 20, offset = 0 }) {
  const params = [];
  let where = '';
  if (category) {
    params.push(category);
    where = `WHERE category = $${params.length}`;
  }
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT * FROM provider_profiles ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/** Update mutable fields of a provider profile. Only provided fields are updated. */
async function updateProviderProfile(userId, fields) {
  const allowed = ['business_name', 'description', 'phone', 'address', 'category'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findByUserId(userId);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE provider_profiles
     SET ${setClause}, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, ...values]
  );
  return rows[0];
}

/** Fetch a provider profile along with the account email from `users` (for notifications). */
async function findWithUserEmail(id) {
  const { rows } = await pool.query(
    `SELECT pp.*, u.email AS user_email
     FROM provider_profiles pp
     JOIN users u ON u.id = pp.user_id
     WHERE pp.id = $1`,
    [id]
  );
  return rows[0];
}

/** Recompute and persist a provider's average rating from their reviews. */
async function refreshAverageRating(providerId) {
  const { rows } = await pool.query(
    `UPDATE provider_profiles
     SET avg_rating = COALESCE(
       (SELECT ROUND(AVG(rating)::numeric, 1) FROM reviews WHERE provider_id = $1), 0
     )
     WHERE id = $1
     RETURNING avg_rating`,
    [providerId]
  );
  return rows[0];
}

module.exports = {
  createProviderProfile,
  findByUserId,
  findById,
  findWithUserEmail,
  listProviders,
  updateProviderProfile,
  refreshAverageRating,
};
