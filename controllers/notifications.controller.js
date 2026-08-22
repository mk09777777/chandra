// Use CommonJS to import the service
const notificationService = require('../services/notifications.service');

/**
 * GET /api/notifications
 * Get all notifications for the logged-in user.
 */

exports.getAll = async (req, res) => {
  try {
    const limit = Math.min(
      parseInt(req.query.limit, 10) || 50,
      100 // hard cap for safety
    );

    const notifications = await notificationService.getUserNotifications(
      req.user._id,
      limit
    );

    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Server error:', error});
  }
};

/**
 * GET /api/notifications/escalations
 * Get the logged-in user's escalation alerts (for the escalation dashboard).
 */
exports.getEscalations = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const notifications = await notificationService.getEscalationNotifications(req.user._id, limit);
    res.status(200).json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/notifications/escalations/unread-count
 * Unread escalation count for the badge.
 */
exports.getEscalationUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadEscalationCount(req.user._id);
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * GET /api/notifications/unread-count
 * Get the unread notification count for the badge.
 */
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await notificationService.getUnreadCount(req.user._id);
    res.status(200).json({ count });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read.
 */
exports.markOneRead = async (req, res) => {
  try {
    const notification = await notificationService.markAsRead(
      req.params.id,
      req.user._id
    );
    res.status(200).json(notification);
  } catch (error) {
    if (error.message.includes('Notification not found')) {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

/**
 * POST /api/notifications/mark-all-read
 * Mark all of the user's notifications as read.
 */
exports.markAllRead = async (req, res) => {
  try {
    await notificationService.markAllAsRead(req.user._id);
    res.status(200).json({ message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
};
