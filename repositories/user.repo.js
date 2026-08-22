const User = require('../models/user.model');
const mongoose = require('mongoose');

// Get all users
exports.getAllUsers = async () => {
  return await User.find();
};

// Get a single user by MongoDB _id
exports.getUser = async (id) => {
  return await User.findById(id);
};

exports.createUser = async (data) => {
  return await User.create(data);
};

exports.updateUser = async (id, data) => {
  return await User.findByIdAndUpdate(id, { $set: data }, { new: true, runValidators: true });
};

exports.getUsersByRole = async (roleId) => {
  const users = await User.find({ role: roleId }).select('_id');
  return users.map(u => u._id);
};

exports.getUsersByRoleFull = async (roleId) => {
  return await User.find({ role: roleId }).select('_id name skills');
};

exports.getUsersByClient = async (clientId) => {
  const users = await User.find({ clientId: clientId }).select('_id');
  return users.map(u => u._id);
};

// Client Handlers (role 5) responsible for a given client — matched via their clientsHandled list.
exports.getClientHandlersForClient = async (clientId) => {
  const users = await User.find({ role: 5, clientsHandled: clientId }).select('_id');
  return users.map(u => u._id);
};

exports.savePushToken = async (userId, token) => {
  if (!userId) {
    throw new Error('User ID is required');
  }
  if (!token) {
    throw new Error('Token is required');
  }

  console.log(`[PushToken] Saving token for user ${userId}`, {
    tokenLength: token.length,
    tokenPreview: token.substring(0, 20) + '...',
  });

  const result = await User.updateOne(
    { _id: userId },
    { $addToSet: { pushTokens: token } } // ✅ CORRECT: Add to array if not exists (supports multiple devices)
  );

  // Check if user exists
  if (result.matchedCount === 0) {
    console.error("[PushToken] ❌ User not found: ${userId}");
    throw new Error('User not found');
  }

  // Log result
  if (result.modifiedCount > 0) {
    console.log("[PushToken] ✅ Token added to user ${userId} (new token)");
  } else {
    console.log("[PushToken] Token already exists for user ${userId} (no change)");
  }

  // Verify token was saved
  const user = await User.findById(userId, { pushTokens: 1 }).lean();
  const tokenCount = user?.pushTokens?.length || 0;
  console.log(`[PushToken] User ${userId} now has ${tokenCount} registered token(s)`);

  return result;
};

/**
 * Fetch only FCM tokens for given user IDs.
 * @param {Array<ObjectId>} userIds
 * @returns {Array<String>} all valid push tokens
 */

exports.getTokensByIds = async (userIds) => {
  if (!userIds?.length) {
    console.log('[FCM] ⚠ No user IDs provided for token retrieval');
    return [];
  }

  const normalizedIds = userIds.map(id => {
    if (typeof id === 'string') {
      // Convert string to ObjectId
      return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
    }
    return id; // Already an ObjectId
  });

  console.log(`[FCM] Getting tokens for ${userIds.length} user(s):`, userIds);
  console.log("[FCM] Normalized IDs:", normalizedIds.map(id => id.toString()));

  // Use less strict query - just check if user exists, not if tokens exist
  // This allows us to see which users don't have tokens
  const users = await User.find(
    { _id: { $in: normalizedIds } },
    { pushTokens: 1, name: 1, email: 1 }
  ).lean();

  const allTokens = users.flatMap((u) => u.pushTokens || []);

  // Log detailed results
  const usersWithTokens = users.filter(u => u.pushTokens && u.pushTokens.length > 0);
  const usersWithoutTokens = users.filter(u => !u.pushTokens || u.pushTokens.length === 0);

  // Check if any requested users were not found
  const foundUserIds = users.map(u => u._id.toString());
  const requestedUserIds = normalizedIds.map(id => id.toString());
  const missingUserIds = requestedUserIds.filter(id => !foundUserIds.includes(id));

  console.log("[FCM] Token retrieval result:", {
    requestedUsers: userIds.length,
    foundUsers: users.length,
    missingUsers: missingUserIds.length,
    totalTokens: allTokens.length,
    usersWithTokens: usersWithTokens.length,
    usersWithoutTokens: usersWithoutTokens.length,
    requestedIds: requestedUserIds,
    foundIds: foundUserIds,
    missingIds: missingUserIds,
    details: {
      withTokens: usersWithTokens.map(u => ({
        id: u._id.toString(),
        name: u.name || 'N/A',
        email: u.email || 'N/A',
        tokenCount: u.pushTokens?.length || 0,
      })),
      withoutTokens: usersWithoutTokens.map(u => ({
        id: u._id.toString(),
        name: u.name || 'N/A',
        email: u.email || 'N/A',
      })),
    },
  });

  if (allTokens.length === 0) {
    console.warn(`[FCM] ⚠ No FCM tokens found for any of the ${userIds.length} requested user(s)`);
    if (missingUserIds.length > 0) {
      console.warn(`[FCM] ⚠ ${missingUserIds.length} user(s) not found in database:`, missingUserIds);
    }
  }

  return allTokens;
};

exports.removePushTokensFromUsers = async (tokens) => {
  return User.updateMany(
    { pushTokens: { $in: tokens } },
    { $pull: { pushTokens: { $in: tokens } } }
  );
}