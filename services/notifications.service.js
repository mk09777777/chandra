// Use CommonJS to import the repository
const repo = require('../repositories/notifications.repo');
const pushService = require('../services/pushNotification.service');
const userService = require('../services/user.service');
const notificationChannels = require('../utils/notificationChannels');

/**
 * Get all notifications for a specific user.
 * (Uses repo.find)
 */
exports.getUserNotifications = async (userId, limit = 50) => {
  const query = { User: userId };
  return repo.find(query, { createdAt: -1 }, limit);
};

/**
 * Get a user's escalation alerts (Type='escalation'), newest first — backs the escalation dashboard.
 */
exports.getEscalationNotifications = async (userId, limit = 50) => {
  const query = { User: userId, Type: 'escalation' };
  return repo.find(query, { createdAt: -1 }, limit);
};

/**
 * Unread escalation-alert count for the current user (badge).
 */
exports.getUnreadEscalationCount = async (userId) => {
  const query = { User: userId, Type: 'escalation', Read: false };
  return repo.count(query);
};

/**
 * Get the unread notification count for a user.
 * (Uses repo.count)
 */
exports.getUnreadCount = async (userId) => {
  const query = { User: userId, Read: false };
  return repo.count(query);
};

/**
 * Mark a single notification as read.
 * (Uses repo.findOneAndUpdate)
 */
exports.markAsRead = async (notificationId, userId) => {
  const query = {
    _id: notificationId,
    User: userId,
  };
  const update = { Read: true };

  const notification = await repo.findOneAndUpdate(
    query,
    update
  );

  if (!notification) {
    throw new Error('Notification not found or user unauthorized');
  }
  return notification;
};

/**
 * Mark all of a user's notifications as read.
 * (Uses repo.updateMany)
 */
exports.markAllAsRead = async (userId) => {
  const query = { User: userId, Read: false };
  const update = { Read: true };
  return repo.updateMany(query, update);
};


/**
 * Creates an alert notification for multiple users at once.
 * Saves to DB for each user, then sends one batch push.
 *
 * @param {Array<string>} userIds - An array of user IDs to notify
 * @param {string} title - The notification title
 * @param {string} body - The notification body
 * @param {string} type - The notification type
 * @param {string} [link] - Optional in-app link
 */
exports.createAlertsForUsers = async (userIds, title, body, type, link) => {
  console.log(`[NOTIFICATION] Creating alerts for ${userIds.length} user(s)`);
  console.log(`[NOTIFICATION] Title: ${title}`);
  console.log(`[NOTIFICATION] Body: ${body}`);
  console.log(`[NOTIFICATION] Type: ${type}`);
  console.log(`[NOTIFICATION] Link: ${link || '(none)'}`);

  // 1. Prepare notification documents for all users
  const notificationsToCreate = userIds.map(userId => ({
    User: userId,
    Title: title,
    Body: body,
    Type: type,
    link: link || '',
    Read: false
  }));

  // 2. --- SAVE FIRST ---
  // Save all notifications to the 'Notifications' collection in one go
  const createdNotifications = await repo.insertMany(
    notificationsToCreate
  );
  console.log(`[NOTIFICATION] ✅ Saved ${createdNotifications.length} notification(s) to database`);

  // 3. --- THEN SEND PUSH ---
  try {
    // Get all tokens for all users (using your existing service)
    console.log(`[NOTIFICATION] Getting FCM tokens for ${userIds.length} user(s)...`);
    const allTokens = await userService.getTokensByIds(userIds);

    if (allTokens && allTokens.length > 0) {
      console.log(`[NOTIFICATION] Found ${allTokens.length} FCM token(s)`);
      
      // Normalize link format (remove leading slash for mobile app compatibility)
      let normalizedLink = link || '';
      if (normalizedLink.startsWith('/')) {
        normalizedLink = normalizedLink.substring(1);
      }

      // Extract IDs from link for data payload
      let enquiryId = '';
      let chatId = '';
      let clientId = '';
      
      if (link) {
        // Extract enquiryId from various link formats
        const enquiryMatch = link.match(/(?:^|\/)(?:enquiries|designs|pricing)\/([a-fA-F0-9]{24})/);
        if (enquiryMatch) {
          enquiryId = enquiryMatch[1];
        }
        
        // Extract chatId
        const chatMatch = link.match(/(?:^|\/)chats\/([a-fA-F0-9]{24})/);
        if (chatMatch) {
          chatId = chatMatch[1];
        }
        
        // Extract clientId
        const clientMatch = link.match(/(?:^|\/)clients\/([a-fA-F0-9]{24})/);
        if (clientMatch) {
          clientId = clientMatch[1];
        }
      }

      // Build push data payload according to FCM specification
      const pushData = {
        type: type || '',
        link: normalizedLink, // Use normalized link (without leading slash)
      };

      // Add IDs if extracted
      if (enquiryId) {
        pushData.enquiryId = enquiryId;
      }
      if (chatId) {
        pushData.chatId = chatId;
      }
      if (clientId) {
        pushData.clientId = clientId;
      }

      // Use "default" channel ID as per FCM specification
      const androidChannelId = 'default';
      console.log(`[NOTIFICATION] Using Android channel: ${androidChannelId} for type: ${type}`);

      // Call your push service once with the combined token list
      console.log(`[NOTIFICATION] Sending push notification to ${allTokens.length} token(s)...`);
      const pushResult = await pushService.sendPushToTokens(
        allTokens,
        title,
        body,
        pushData,
        androidChannelId
      );
      
      if (pushResult?.error) {
        console.error(`[NOTIFICATION] ❌ Push notification failed:, pushResult.error`);
        console.error(`[NOTIFICATION] Error code:, pushResult.errorCode`);
      } else if (pushResult) {
        console.log(`[NOTIFICATION] ✅ Push notification sent: ${pushResult.successCount || 0} success, ${pushResult.failureCount || 0} failed`);
      } else {
        console.log(`[NOTIFICATION] ✅ Push notification sent successfully`);
      }

    } else {
      console.log(`[NOTIFICATION] ⚠ No FCM tokens found for users, push not sent.`);
    }
  } catch (error) {
    console.error(`[NOTIFICATION] ❌ Failed to send push for bulk alerts:`, error);
    throw error; // Re-throw to allow caller to handle
  }

  return createdNotifications;
};