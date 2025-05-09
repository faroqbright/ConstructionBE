import mongoose, { Schema } from "mongoose";

const notificationSettingSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User", // Assuming you have a 'User' model
      required: true,
      unique: true, // Each user has one set of notification settings
      index: true,
    },
    projectReportsEnabled: {
      type: Boolean,
      default: true, // Default to enabled
    },
    projectUpdatesEnabled: {
      type: Boolean,
      default: true, // Default to enabled
    },
    financialUpdatesEnabled: {
      type: Boolean,
      default: true, // Default to enabled
    },
    // You can add more notification types here in the future
  },
  { timestamps: true }
);

export const NotificationSetting = mongoose.model(
  "NotificationSetting",
  notificationSettingSchema
);