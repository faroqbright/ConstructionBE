import mongoose from "mongoose";

const additionalMilestoneSchema = new mongoose.Schema(
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
    status: {
      type: String,
      enum: ["pending", "completed"],
      default: "pending",
    },
    completedAt: {
      type: Date,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    userId:
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
  },
  {
    timestamps: true,
  }
);

export const AdditionalMilestone = mongoose.model(
  "AdditionalMilestone",
  additionalMilestoneSchema
);