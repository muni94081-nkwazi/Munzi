/**
 * Tracks which users are currently connected, and how many sockets each
 * has open (a user can have multiple tabs/devices - they're only
 * "offline" once the last one disconnects).
 *
 * In-memory and per-process: fine for a single Node instance. If bulk-backend
 * ever runs multiple instances behind a load balancer, swap this for a
 * shared store (e.g. Redis) and use the socket.io-redis adapter so rooms
 * and presence work across instances too.
 */
const socketCountByUser = new Map();

/** Returns true if this was the user's first open socket (i.e. they just came online). */
function addConnection(userId) {
  const count = socketCountByUser.get(userId) || 0;
  socketCountByUser.set(userId, count + 1);
  return count === 0;
}

/** Returns true if this was the user's last open socket (i.e. they just went offline). */
function removeConnection(userId) {
  const count = socketCountByUser.get(userId) || 0;
  const next = Math.max(0, count - 1);
  if (next === 0) {
    socketCountByUser.delete(userId);
    return true;
  }
  socketCountByUser.set(userId, next);
  return false;
}

function isOnline(userId) {
  return socketCountByUser.has(userId);
}

module.exports = { addConnection, removeConnection, isOnline };
