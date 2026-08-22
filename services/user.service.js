const bcrypt = require('bcrypt');
const repo = require('../repositories/user.repo');

// Get all users
exports.getUsers = async () => {
    return await repo.getAllUsers();
};

exports.createUser = async (data) => {
    const { name, email, phone, role, password, clientId, clientsHandled, skills, group } = data;
    const hashedPassword = await bcrypt.hash(password, 10);
    return await repo.createUser({ name, email, phone, role, password: hashedPassword, clientId, clientsHandled, skills, group });
};

const UPDATABLE_FIELDS = ['name', 'email', 'phone', 'role', 'clientId', 'clientsHandled', 'skills', 'group'];

exports.updateUser = async (id, data) => {
    const update = {};
    for (const field of UPDATABLE_FIELDS) {
        if (data[field] !== undefined) update[field] = data[field];
    }
    return await repo.updateUser(id, update);
};

// Get a user by ID
exports.getUserById = async (id) => {
    return await repo.getUser(id);
};

exports.getUsersByRole = async (roleId) => {
    return await repo.getUsersByRole(roleId);
}

exports.getUsersByRoleFull = async (roleId) => {
    return await repo.getUsersByRoleFull(roleId);
}

exports.getUsersByClient = async (clientId) => {
    return await repo.getUsersByClient(clientId);
}

exports.getClientHandlersForClient = async (clientId) => {
    return await repo.getClientHandlersForClient(clientId);
}

exports.savePushToken = async (userId, token) => {
  return await repo.savePushToken(userId, token);
};

exports.getTokensByIds = async (userIds) => await repo.getTokensByIds(userIds);

exports.removePushTokensFromUsers = async (tokens) => {
  return await repo.removePushTokensFromUsers(tokens);
}
