const userRepo = require('../repositories/user.repo');

// Role Id 5 = 'Client Handler' (see Codelist where Type='Roles')
const CLIENT_HANDLER_ROLE = 5;

exports.getEnquiryScope = async (userId) => {
    const user = await userRepo.getUser(userId);
    if (!user) throw new Error('User not found');
    if (user.role !== CLIENT_HANDLER_ROLE) return null;
    return { clientIds: user.clientsHandled || [] };
};

exports.applyClientScope = (requestedClientId, scope) => {
    if (!scope) {
        return requestedClientId ? { clientId: requestedClientId } : {};
    }
    const allowed = scope.clientIds;
    if (requestedClientId) {
        return allowed.includes(requestedClientId)
            ? { clientId: requestedClientId }
            : { clientIds: [] };
    }
    return { clientIds: allowed };
};
