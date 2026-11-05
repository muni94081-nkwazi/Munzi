const pool = require('../config/db');

/**
 * Creates a password-reset token row in the database.
 */
async function createResetToken({ userId, token, expiresAt }) {
  // Invalidate any previous unused tokens for this user.
  await pool.query(
    `UPDATE password_reset_tokens SET used = true WHERE user_id = $1 AND used = false`,
    [userId]
  );

  const { rows } = await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, token, expires_at`,
    [userId, token, expiresAt]
  );
  return rows[0];
}

/**
 * Finds a valid (unused, not expired) token row.
 */
async function findValidToken(token) {
  const { rows } = await pool.query(
    `SELECT prt.*, u.email, u.role
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token = $1
       AND prt.used = false
       AND prt.expires_at > NOW()`,
    [token]
  );
  return rows[0] || null;
}

/**
 * Marks a token as used so it cannot be re-used.
 */
async function markUsed(id) {
  await pool.query(
    `UPDATE password_reset_tokens SET used = true WHERE id = $1`,
    [id]
  );
}

module.exports = { createResetToken, findValidToken, markUsed };
