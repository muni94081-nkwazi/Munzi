const pool = require('../config/db');

/**
 * Create a new user record.
 * @param {{email: string, passwordHash: string, role: 'provider'|'customer'}} data
 */
async function createUser({ email, passwordHash, role }) {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING id, email, role, created_at`,
    [email, passwordHash, role]
  );
  return rows[0];
}

/** Find a user by email (includes password_hash, needed for login). */
async function findByEmail(email) {
  const { rows } = await pool.query(`SELECT * FROM users WHERE email = $1`, [email]);
  return rows[0];
}

/** Find a user by id (public fields only). */
async function findById(id) {
  const { rows } = await pool.query(
    `SELECT id, email, role, is_active, created_at FROM users WHERE id = $1`,
    [id]
  );
  return rows[0];
}

module.exports = { createUser, findByEmail, findById };
