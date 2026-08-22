const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {type: String, required: true},
    email: {type: String, unique: true},
    phone: {type: String, unique: true},
    role: {type: Number, required: true},
    password: {type: String, required: true},
    clientId: { type: String, ref: 'Client' },
    clientsHandled: [{ type: String, ref: 'Client' }],
    pushTokens: [{ type: String }],
    skills: { type: String },
    group: { type: String, enum: ['Bridal', 'Hip-hop', 'Cuban'] }
});

module.exports = mongoose.model('User', userSchema);
