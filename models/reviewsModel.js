  import mongoose from "mongoose";

  const reviewSchema = new mongoose.Schema(
    {
      projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: [true, "Project ID is required"],
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: [true, "User ID is required"],
      },
      message: {
        type: String,
        required: [true, "Message is required"],
      },
      rating: {
        type: Number,
        min: 1,
        max: 5,
        default: 5,
      },
    },
    { timestamps: true }
  );

  export const Review = mongoose.model("Review", reviewSchema);
