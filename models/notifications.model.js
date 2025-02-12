import mongoose from "mongoose";

const notificationsSchema = new mongoose.Schema(
  {
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
         type: Date,
         default: Date.now 
        },
},{
    timestamps: true,
  }
);

export const Notification = mongoose.model("Notification", notificationsSchema);
