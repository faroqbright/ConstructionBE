import mongoose, { Schema } from "mongoose";

const notificationSettingSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: Boolean,
      default: true, // All notifications enabled by default
    },
  },
  { timestamps: true }
);

export const NotificationSetting = mongoose.model(
  "NotificationSetting",
  notificationSettingSchema
);
