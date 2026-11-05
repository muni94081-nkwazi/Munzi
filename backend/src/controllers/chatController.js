const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const messageModel = require('../models/messageModel');
const userModel = require('../models/userModel');
const onlineUsers = require('../socket/onlineUsers');

/**
 * @route   GET /api/chats
 * @desc    List all of the current user's conversations, each with the
 *          other participant's info, the most recent message, and an
 *          unread count.
 * @access  Private
 */
const listChats = asyncHandler(async (req, res) => {
  const chats = await messageModel.listConversations(req.user.id);
  res.status(200).json({ success: true, data: chats });
});

/**
 * @route   GET /api/chats/:otherUserId/messages
 * @desc    Full message history with a specific user, oldest first.
 *          Supports ?before=<ISO timestamp>&limit= for loading older
 *          messages as the chat window scrolls up.
 * @access  Private
 */
const getMessages = asyncHandler(async (req, res) => {
  const { otherUserId } = req.params;
  const { before, limit } = req.query;

  const otherUser = await userModel.findById(otherUserId);
  if (!otherUser) throw new AppError('User not found.', 404);

  const messages = await messageModel.getConversation(req.user.id, otherUserId, {
    before,
    limit: limit ? Number(limit) : undefined,
  });
  res.status(200).json({ success: true, data: messages });
});

/**
 * @route   PATCH /api/chats/:otherUserId/read
 * @desc    Mark every message from otherUserId as read. Mirrors the
 *          'mark_read' Socket.io event - provided as a REST fallback for
 *          clients that aren't connected to the socket (or as a simpler
 *          call from a page that just opened a chat).
 * @access  Private
 */
const markRead = asyncHandler(async (req, res) => {
  const { otherUserId } = req.params;
  const updatedCount = await messageModel.markConversationRead(req.user.id, otherUserId);
  res.status(200).json({ success: true, data: { updatedCount } });
});

/**
 * @route   GET /api/chats/unread-count
 * @desc    Total unread messages across all conversations, for a navbar badge.
 * @access  Private
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await messageModel.getTotalUnreadCount(req.user.id);
  res.status(200).json({ success: true, data: { count } });
});

/**
 * @route   GET /api/chats/:otherUserId/online
 * @desc    Whether the other user currently has an open connection.
 *          Socket 'presence' events keep this live after the chat window
 *          mounts; this is just for the initial render.
 * @access  Private
 */
const getOnlineStatus = asyncHandler(async (req, res) => {
  const { otherUserId } = req.params;
  res.status(200).json({ success: true, data: { online: onlineUsers.isOnline(otherUserId) } });
});

module.exports = { listChats, getMessages, markRead, getUnreadCount, getOnlineStatus };
