import mongoose from "mongoose";

const businessAreaSchema = new mongoose.Schema(
  {
    businessArea: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
  },
  {
    timestamps: true,
  }
);

export const BusinessArea = mongoose.model("BusinessArea", businessAreaSchema);
