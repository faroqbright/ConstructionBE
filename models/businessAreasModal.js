import mongoose from "mongoose";

const businessAreaSchema = new mongoose.Schema(
  {
    businessArea: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role", 
    },
  },
  {
    timestamps: true,
  }
);

export const BusinessArea = mongoose.model("BusinessArea", businessAreaSchema);
