import mongoose from "mongoose";

const editProjectSchema = new mongoose.Schema(
  {
    projectOwners: [
      {
        ownerId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true 
        },
        ownerName: {
          type: String,
          required: true,
        },
      },
    ],
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: "UserDocument" }],
    projectName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    projectBanner: {
      type: [
        {
          url: String,
          uploadDate: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      required: true,
      trim: true,
      enum: [
        "Ongoing",
        "Pending",
        "Completed",
        "Awaiting Start",
        "On Hold",
        "Cancelled",
        "Archived",
      ], // Professional project statuses
      default: "Pending",
    },
    deadline: {
      type: String,
      required: true,
      trim: true,
    },
    physicalEducationRange: {
      type: Number,
      required: true,
      min: 1, // Minimum value
      max: 100, // Maximum value
    },
    daysLeft: {
      type: String,
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    logs: [
      {
        actionType: { type: String, required: true }, // Type of action (e.g., "status update", "name change")
        message: { type: String, required: true }, // Descriptive message of the action
        timestamp: { type: Date, default: Date.now },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Optional, who performed the action
      },
    ],
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
  }
);

export const editProject = mongoose.model("editProject", editProjectSchema);
