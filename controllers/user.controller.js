const service = require('../services/user.service');

const toUserDto = (user) => ({
    Id:             user._id,
    Name:           user.name,
    Role:           user.role,
    Skills:         user.skills,
    email:          user.email,
    phone:          user.phone,
    clientId:       user.clientId,
    clientsHandled: user.clientsHandled || [],
    Group:          user.group,
});

const toUserListDto = (user) => ({
    Id:             user._id,
    Name:           user.name,
    Role:           user.role,
    Skills:         user.skills,
    Group:          user.group,
    clientsHandled: user.clientsHandled || [],
});

exports.getUsers = async (req, res) => {
    try {
        const users = await service.getUsers();
        res.json(users.map(toUserListDto));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getUserById = async (req, res) => {
    try {
        const user = await service.getUserById(req.params.id);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(toUserDto(user));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createUser = async (req, res) => {
    try {
        const { name, email, phone, role, password, clientId, clientsHandled, skills, group } = req.body;
        if (!name || !email || !role || !password) {
            return res.status(400).json({ message: 'name, email, role and password are required' });
        }
        const user = await service.createUser({ name, email, phone, role, password, clientId, clientsHandled, skills, group });
        res.status(201).json(toUserDto(user));
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Email or phone already in use' });
        }
        console.error('Error creating user:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.updateUser = async (req, res) => {
    try {
        const user = await service.updateUser(req.params.id, req.body);
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(toUserDto(user));
    } catch (err) {
        if (err.code === 11000) {
            return res.status(409).json({ message: 'Email or phone already in use' });
        }
        console.error('Error updating user:', err);
        res.status(500).json({ error: err.message });
    }
};

exports.savePushToken = async (req, res) => {
    try {
        const userId = req.user._id;
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ message: 'Push token is required' });
        }
        await service.savePushToken(userId, token);
        res.status(200).json({ message: 'Push token saved successfully' });
    } catch (error) {
        console.error('Error saving push token:', error);
        res.status(500).json({ message: 'Failed to save push token' });
    }
};
