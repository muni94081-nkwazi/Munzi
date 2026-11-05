const pool = require('../config/db');

/** Insert a new message. */
async function createMessage({ senderId, receiverId, message, attachmentUrl }) {
  const { rows } = await pool.query(
    `INSERT INTO messages (sender_id, receiver_id, message, attachment_url)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [senderId, receiverId, message, attachmentUrl || null]
  );
  return rows[0];
}

/**
 * Full message history between two users (both directions), oldest first.
 * Cursor-paginated via `before` (an ISO timestamp) so the chat window can
 * load older messages as the user scrolls up.
 */
async function getConversation(userIdA, userIdB, { before, limit = 50 } = {}) {
  const params = [userIdA, userIdB];
  let cursorClause = '';
  if (before) {
    params.push(before);
    cursorClause = `AND created_at < $${params.length}`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT * FROM messages
     WHERE ((sender_id = $1 AND receiver_id = $2) OR (sender_id = $2 AND receiver_id = $1))
       ${cursorClause}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params
  );
  return rows.reverse(); // oldest-first for rendering top-to-bottom
}

/**
 * One row per conversation the user is part of: the other participant's
 * basic info, the most recent message, and how many unread messages are
 * waiting from that person.
 */
async function listConversations(userId) {
  const { rows } = await pool.query(
    `WITH conversation_partners AS (
       SELECT DISTINCT
         CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id
       FROM messages
       WHERE sender_id = $1 OR receiver_id = $1
     ),
     last_messages AS (
       SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
         m.*
       FROM messages m
       JOIN conversation_partners cp
         ON cp.other_user_id = CASE WHEN m.sender_id = $1 THEN m.receiver_id ELSE m.sender_id END
       WHERE m.sender_id = $1 OR m.receiver_id = $1
       ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC
     ),
     unread_counts AS (
       SELECT sender_id AS other_user_id, COUNT(*) AS unread_count
       FROM messages
       WHERE receiver_id = $1 AND read = false
       GROUP BY sender_id
     )
     SELECT
       cp.other_user_id,
       u.email AS other_user_email,
       u.role AS other_user_role,
       COALESCE(pp.business_name, cust.full_name) AS other_user_name,
       lm.message AS last_message,
       lm.created_at AS last_message_at,
       lm.sender_id AS last_message_sender_id,
       COALESCE(uc.unread_count, 0)::int AS unread_count
     FROM conversation_partners cp
     JOIN users u ON u.id = cp.other_user_id
     LEFT JOIN provider_profiles pp ON pp.user_id = u.id
     LEFT JOIN customer_profiles cust ON cust.user_id = u.id
     LEFT JOIN last_messages lm
       ON LEAST(lm.sender_id, lm.receiver_id) = LEAST($1::uuid, cp.other_user_id)
      AND GREATEST(lm.sender_id, lm.receiver_id) = GREATEST($1::uuid, cp.other_user_id)
     LEFT JOIN unread_counts uc ON uc.other_user_id = cp.other_user_id
     ORDER BY lm.created_at DESC NULLS LAST`,
    [userId]
  );
  return rows;
}

/** Marks every message FROM otherUserId TO userId as read. Returns how many were updated. */
async function markConversationRead(userId, otherUserId) {
  const { rowCount } = await pool.query(
    `UPDATE messages SET read = true
     WHERE receiver_id = $1 AND sender_id = $2 AND read = false`,
    [userId, otherUserId]
  );
  return rowCount;
}

/** Total unread messages across all conversations, for a navbar badge. */
async function getTotalUnreadCount(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM messages WHERE receiver_id = $1 AND read = false`,
    [userId]
  );
  return rows[0].count;
}

/** Every distinct user this person has ever exchanged messages with - used to scope presence broadcasts. */
async function getConversationPartnerIds(userId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS other_user_id
     FROM messages
     WHERE sender_id = $1 OR receiver_id = $1`,
    [userId]
  );
  return rows.map((r) => r.other_user_id);
}

module.exports = {
  createMessage,
  getConversation,
  listConversations,
  markConversationRead,
  getTotalUnreadCount,
  getConversationPartnerIds,
};
