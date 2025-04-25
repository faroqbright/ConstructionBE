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
    type: {
      type: String,
      enum: ["client", "financial"],
      required: true,
    },
    clientIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "Company", 
    
    },
    userIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: "User",  
    
    },
  },
  {
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const Notification = mongoose.model("Notification", notificationsSchema);