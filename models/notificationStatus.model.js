// import mongoose from "mongoose";

// const notificationStatusSchema = new mongoose.Schema(
//   {
//     notifications: [
//       {
//         title: { type: String, trim: true },
//         description: { type: String, trim: true },
//         status: { type: Boolean, required: true },
//       },
//     ],
//   },
//   { timestamps: true }
// );

// const NotificationStatus = mongoose.model(
//   "notificationStatus",
//   notificationStatusSchema
// );

// export default NotificationStatus;

import mongoose from "mongoose";

const notificationStatusSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true },
    status: { type: Boolean, required: true },
  },
  { timestamps: true }
);

const NotificationStatus = mongoose.model(
  "NotificationsStatus",
  notificationStatusSchema
);

export default NotificationStatus;
