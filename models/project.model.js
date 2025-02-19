import mongoose from "mongoose";

const editProjectSchema = new mongoose.Schema(
  {
    projectOwner: { type: String, required: true, trim: true },
    projectOwnerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    projectName: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    location: { type: String, required: true, trim: true },
    projectBanner: { type: String }, // Store the image URL
    attachments: { type: String }, // Array of attachment file URLs
    status: {
      type: String,
      required: true,
      trim: true,
      enum: ["Ongoing", "Pending", "Completed", "Awaiting Start", "On Hold", "Cancelled", "Archived"],
      default: "Pending",
    },
    deadline: { type: String, required: true, trim: true },
    physicalEducationRange: { type: Number, required: true, min: 1, max: 100 },
    daysLeft: { type: String, required: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    logs: [
      {
        actionType: { type: String, required: true },
        message: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
  },
  { timestamps: true }
);

export const editProject = mongoose.model("editProject", editProjectSchema);
