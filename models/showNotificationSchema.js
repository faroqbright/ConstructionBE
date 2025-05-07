import mongoose, { Schema } from "mongoose";

const showNotificationSchema = new Schema(
  {
    title: {
      type: String,
      required: [true, "Notification title is required"],
      trim: true,
    },
    type: {
      type: String,
      required: [true, "Notification type is required"],
      // Optional: Add enum for specific types later if needed
      // enum: ['Project Update', 'Task Assignment', 'Mention', 'System Alert', 'New Document'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    lengthyDesc: {
      type: String,
      trim: true,
    },
    // Changed ownerId/memberId to recipientId for clarity
    // A notification is typically *for* one specific user
    memberId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Recipient user ID is required"],
      index: true, // Index for faster querying by recipient
    },
    projectId: {
      type: Schema.Types.ObjectId,
      ref: "editProject", // Reference the project model
      index: true, // Index for faster querying by project
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true, // Index for filtering read/unread
    },
    // Optional: Add who triggered the notification if needed
    // triggeredBy: {
    //   type: Schema.Types.ObjectId,
    //   ref: "User"
    // },
  },
  { timestamps: true } // Automatically adds createdAt and updatedAt
);

export const ShowNotification = mongoose.model("ShowNotification", showNotificationSchema);