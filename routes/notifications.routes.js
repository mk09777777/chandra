const express = require('express');
const router = express.Router();
const controller = require('../controllers/notifications.controller');
const authenticateToken = require('../middleware/authenticateToken');

// --- User-facing routes ---
// Get all notifications
router.get('/', authenticateToken, controller.getAll);

// Get unread count
router.get(
  '/unread-count',
  authenticateToken,
  controller.getUnreadCount
);

// Escalation dashboard — the user's escalation alerts + unread badge
router.get('/escalations', authenticateToken, controller.getEscalations);
router.get('/escalations/unread-count', authenticateToken, controller.getEscalationUnreadCount);

// Mark one as read
router.patch(
  '/:id/read',
  authenticateToken,
  controller.markOneRead
);

// Mark all as read
router.post(
  '/mark-all-read',
  authenticateToken,
  controller.markAllRead
);

module.exports = router;