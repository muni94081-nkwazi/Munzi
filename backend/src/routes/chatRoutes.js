const express = require('express');
const router = express.Router();

const chatController = require('../controllers/chatController');
const { protect } = require('../middleware/auth');

// GET /api/chats - list all conversations for the current user
router.get('/', protect, chatController.listChats);

// GET /api/chats/unread-count - total unread across all conversations
router.get('/unread-count', protect, chatController.getUnreadCount);

// GET /api/chats/:otherUserId/messages - full history with one person
router.get('/:otherUserId/messages', protect, chatController.getMessages);

// GET /api/chats/:otherUserId/online - is this person currently connected?
router.get('/:otherUserId/online', protect, chatController.getOnlineStatus);

// PATCH /api/chats/:otherUserId/read - mark that person's messages as read
router.patch('/:otherUserId/read', protect, chatController.markRead);

module.exports = router;
