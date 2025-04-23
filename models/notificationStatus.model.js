import mongoose from "mongoose";

const notificationStatusSchema = new mongoose.Schema(
  {
    notifications: [
      {
        title: { type: String, trim: true },
        description: { type: String, trim: true },
        status: { type: Boolean, required: true },
      },
    ],
  },
  { timestamps: true }
);

const NotificationStatus = mongoose.model(
  "notificationStatus",
  notificationStatusSchema
);

export default NotificationStatus;
