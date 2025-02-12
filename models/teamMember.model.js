import mongoose from "mongoose";

const teamMemberSchema = new mongoose.Schema(
  {
    
    email: {
      type: String,
      required: true,
      trim: true,
    },
  
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatar: {
      type: String, 
  },
  role: {
    type: String,
    required: true,
    trim: true,
    enum: [
      "Coordinator",
      "Security Technician",
      "Supervisor"]
  },
  },
  {
    timestamps: true,
  }
);

export const teamMember = mongoose.model("teamMember", teamMemberSchema);
