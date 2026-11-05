const { initFirebaseAdmin } = require('../config/firebase');
const pool = require('../config/db');

/**
 * All functions here are "fire and forget" from the caller's point of view:
 * a failed push (bad token, Firebase down, not configured, etc.) is logged
 * and swallowed, never thrown - the same "best effort" philosophy as
 * sendBookingRequestEmail in mailer.js. A booking action succeeding should
 * never depend on a push notification succeeding.
 */

/**
 * Send a single notification to one user by their id (looks up their
 * stored fcm_token). Silently no-ops if the user has no token on file.
 *
 * @param {string} userId
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 */
async function sendToUser(userId, payload) {
  const { rows } = await pool.query('SELECT fcm_token FROM users WHERE id = $1', [userId]);
  const token = rows[0]?.fcm_token;
  if (!token) return { sent: false, reason: 'no_token' };
  return sendToToken(token, payload);
}

/**
 * Send the same notification to several users at once (e.g. both parties on
 * a cancelled booking). Resolves tokens for all given user ids, then sends
 * via sendEachForMulticast in one batched call.
 *
 * @param {string[]} userIds
 * @param {{ title: string, body: string, data?: Record<string,string> }} payload
 */
async function sendToUsers(userIds, payload) {
  if (!userIds || userIds.length === 0) return { sent: false, reason: 'no_recipients' };

  const { rows } = await pool.query(
    `SELECT fcm_token FROM users WHERE id = ANY($1::uuid[]) AND fcm_token IS NOT NULL`,
    [userIds]
  );
  const tokens = rows.map((r) => r.fcm_token).filter(Boolean);
  if (tokens.length === 0) return { sent: false, reason: 'no_tokens' };

  const firebaseAdmin = initFirebaseAdmin();
  if (!firebaseAdmin) return { sent: false, reason: 'firebase_not_configured' };

  try {
    const response = await firebaseAdmin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: stringifyData(payload.data),
    });
    logMulticastFailures(response, tokens);
    return { sent: true, successCount: response.successCount, failureCount: response.failureCount };
  } catch (err) {
    console.error('Failed to send multicast push notification:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

/** Low-level single-token send, used directly by sendToUser. */
async function sendToToken(token, payload) {
  const firebaseAdmin = initFirebaseAdmin();
  if (!firebaseAdmin) return { sent: false, reason: 'firebase_not_configured' };

  try {
    await firebaseAdmin.messaging().send({
      token,
      notification: { title: payload.title, body: payload.body },
      data: stringifyData(payload.data),
    });
    return { sent: true };
  } catch (err) {
    // A token that's expired/uninstalled comes back as one of these codes -
    // clear it so we stop trying (and stop paying the round-trip cost).
    if (
      err.code === 'messaging/registration-token-not-registered' ||
      err.code === 'messaging/invalid-registration-token'
    ) {
      await pool.query('UPDATE users SET fcm_token = NULL WHERE fcm_token = $1', [token]).catch(() => {});
    }
    console.error('Failed to send push notification:', err.message);
    return { sent: false, reason: 'send_failed' };
  }
}

function logMulticastFailures(response, tokens) {
  response.responses.forEach((r, i) => {
    if (!r.success) console.warn(`Push to token ${tokens[i].slice(0, 12)}… failed: ${r.error?.message}`);
  });
}

/** FCM's `data` payload must be a flat object of string values. */
function stringifyData(data = {}) {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
}

module.exports = { sendToUser, sendToUsers };
