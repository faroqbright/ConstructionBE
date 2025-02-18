import mongoose from "mongoose";

const roleSchema = new mongoose.Schema(
  {
    roleName: {
      type: String,
      required: true,
      trim: true,
      unique: true, // Ensure role names are unique
    },
    // createdBy: {
    //   type: String,
    //   required: true,
    
    // },
    status: {
      type: String,
      required: true,
      enum: ["Active", "Delete", "Block"], // Allow only specific statuses
      default: "Active",
    },
    permissions: [
        {
          type: Map,
          of: mongoose.Schema.Types.Mixed, // This allows key-value pairs with mixed types
        },
      ],
  },
  {
    timestamps: true, // Add createdAt and updatedAt fields
  }
);

export const Role = mongoose.model("Role", roleSchema);
