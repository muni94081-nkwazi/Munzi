const { Server } = require('socket.io');
const { verifyToken } = require('../utils/token');
const messageModel = require('../models/messageModel');
const onlineUsers = require('./onlineUsers');

/** Deterministic room name for a two-person conversation, order-independent. */
function conversationRoom(userIdA, userIdB) {
  return `conversation:${[userIdA, userIdB].sort().join('_')}`;
}

/** Personal room every one of a user's sockets (all tabs/devices) sits in. */
function personalRoom(userId) {
  return `user:${userId}`;
}

/**
 * Attaches Socket.io to an existing HTTP server and wires up all chat
 * events. Called once from server.js alongside app.listen.
 *
 * Client connects with:
 *   io(url, { auth: { token: '<JWT from login>' } })
 *
 * Events emitted BY THE CLIENT (see frontend src/socket.js for the mirror):
 *   join_room    { otherUserId }
 *   leave_room   { otherUserId }
 *   send_message { receiverId, message, attachmentUrl? }
 *   typing       { receiverId, isTyping }
 *   mark_read    { otherUserId }
 *
 * Events emitted BY THE SERVER:
 *   new_message    <message row>
 *   typing         { senderId, isTyping }
 *   messages_read  { readBy }
 *   presence       { userId, online }
 *   error          { message }
 */
function initSocket(httpServer, corsOrigin) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin || '*' },
  });

  // ─── Auth middleware - every connection must present a valid JWT ─────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication required.'));

      const decoded = verifyToken(token);
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('Invalid or expired token.'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;
    socket.join(personalRoom(userId));

    const justCameOnline = onlineUsers.addConnection(userId);
    if (justCameOnline) {
      broadcastPresence(io, userId, true).catch((err) =>
        console.error('Failed to broadcast presence (online):', err.message)
      );
    }

    // ── join_room / leave_room - scopes typing indicators to one open chat ──
    socket.on('join_room', ({ otherUserId } = {}) => {
      if (!otherUserId) return;
      socket.join(conversationRoom(userId, otherUserId));
    });

    socket.on('leave_room', ({ otherUserId } = {}) => {
      if (!otherUserId) return;
      socket.leave(conversationRoom(userId, otherUserId));
    });

    // ── send_message ─────────────────────────────────────────────────
    socket.on('send_message', async ({ receiverId, message, attachmentUrl } = {}, ack) => {
      try {
        if (!receiverId || (!message?.trim() && !attachmentUrl)) {
          throw new Error('receiverId and a non-empty message or attachment are required.');
        }
        if (receiverId === userId) {
          throw new Error('Cannot send a message to yourself.');
        }

        const saved = await messageModel.createMessage({
          senderId: userId,
          receiverId,
          message: message?.trim() || '',
          attachmentUrl,
        });

        // Deliver to every open socket (all tabs/devices) of BOTH parties,
        // via their personal rooms only - not the conversation room too,
        // which would double-deliver to anyone with that chat window open.
        io.to(personalRoom(receiverId)).to(personalRoom(userId)).emit('new_message', saved);

        if (typeof ack === 'function') ack({ success: true, data: saved });
      } catch (err) {
        console.error('send_message failed:', err.message);
        socket.emit('error', { message: err.message || 'Failed to send message.' });
        if (typeof ack === 'function') ack({ success: false, message: err.message });
      }
    });

    // ── typing indicator - scoped to whoever has this specific chat open ──
    socket.on('typing', ({ receiverId, isTyping } = {}) => {
      if (!receiverId) return;
      socket.to(conversationRoom(userId, receiverId)).emit('typing', { senderId: userId, isTyping: !!isTyping });
    });

    // ── mark_read ─────────────────────────────────────────────────────
    socket.on('mark_read', async ({ otherUserId } = {}, ack) => {
      try {
        if (!otherUserId) throw new Error('otherUserId is required.');
        const updatedCount = await messageModel.markConversationRead(userId, otherUserId);
        io.to(personalRoom(otherUserId)).emit('messages_read', { readBy: userId });
        if (typeof ack === 'function') ack({ success: true, data: { updatedCount } });
      } catch (err) {
        socket.emit('error', { message: err.message || 'Failed to mark messages as read.' });
        if (typeof ack === 'function') ack({ success: false, message: err.message });
      }
    });

    // ── disconnect / reconnect handling ─────────────────────────────────
    // Socket.io's client auto-reconnects on transient drops by default; we
    // only need to react to the *last* socket for a user actually closing.
    socket.on('disconnect', async () => {
      const wentOffline = onlineUsers.removeConnection(userId);
      if (wentOffline) {
        broadcastPresence(io, userId, false).catch((err) =>
          console.error('Failed to broadcast presence (offline):', err.message)
        );
      }
    });
  });

  return io;
}

/** Tells everyone this user has ever chatted with that their online status changed. */
async function broadcastPresence(io, userId, online) {
  const partnerIds = await messageModel.getConversationPartnerIds(userId);
  partnerIds.forEach((partnerId) => {
    io.to(personalRoom(partnerId)).emit('presence', { userId, online });
  });
}

module.exports = { initSocket };
