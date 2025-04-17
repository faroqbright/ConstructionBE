import mongoose from 'mongoose';

const businessAreaSchema = new mongoose.Schema(
  {
    businessArea: {
      type: String,
      required: true,
      unique: true,
    },
    role: {
      type: String,
      required: true,  
      ref: 'Role',                           
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const BusinessArea = mongoose.model('BusinessArea', businessAreaSchema);
