const pool = require('../config/db');

/** Create a customer profile row linked to a user. */
async function createCustomerProfile({ userId, fullName, phone, address }) {
  const { rows } = await pool.query(
    `INSERT INTO customer_profiles (user_id, full_name, phone, address)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [userId, fullName, phone || null, address || null]
  );
  return rows[0];
}

/** Find customer profile by the underlying user_id. */
async function findByUserId(userId) {
  const { rows } = await pool.query(`SELECT * FROM customer_profiles WHERE user_id = $1`, [userId]);
  return rows[0];
}

/** Find customer profile by its own id (customer_profiles.id). */
async function findById(id) {
  const { rows } = await pool.query(`SELECT * FROM customer_profiles WHERE id = $1`, [id]);
  return rows[0];
}

/** Update mutable fields of a customer profile. Only provided fields are updated. */
async function updateCustomerProfile(userId, fields) {
  const allowed = ['full_name', 'phone', 'address'];
  const keys = Object.keys(fields).filter((k) => allowed.includes(k));
  if (keys.length === 0) return findByUserId(userId);

  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values = keys.map((k) => fields[k]);

  const { rows } = await pool.query(
    `UPDATE customer_profiles
     SET ${setClause}, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [userId, ...values]
  );
  return rows[0];
}

module.exports = { createCustomerProfile, findByUserId, findById, updateCustomerProfile };
