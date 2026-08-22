const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema(
  {
    // The user who this notification is FOR
    User: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User', // Links to your 'User' collection
      required: true,
      index: true, // Speeds up queries for a user's notifications
    },

    // The title and body of the message
    Title: {
      type: String,
      required: true,
      trim: true,
    },
    Body: {
      type: String,
      required: true,
      trim: true,
    },

    // Has the user seen this yet?
    Read: {
      type: Boolean,
      default: false,
    },

    // What kind of notification is this?
    // This lets your app show different icons (e.g., a bell vs. an assignment)
    Type: {
      type: String,
      enum: [
        'enquiry_created',
        'enquiry_assigned',
        'enquiry_updated',
        'new_message',
        'asset_upload',
        'escalation',
        'system_alert',
        'other',
      ],
      default: 'system_alert',
    },

    // What happens when the user clicks it?
    // This is the in-app route, e.g., "/enquiries/12345"
    Link: {
      type: String,
    },
  },
  {
    // This automatically adds `createdAt` and `updatedAt` fields
    timestamps: true,
  }
);

module.exports = mongoose.model('Notification', NotificationSchema);