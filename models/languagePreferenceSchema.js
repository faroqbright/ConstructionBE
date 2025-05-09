import mongoose, { Schema } from "mongoose";

const languagePreferenceSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User", // Assuming you have a 'User' model
      required: true,
      unique: true, // Each user can only have one language preference entry
      index: true,
    },
    languageSelected: {
      type: String,
      required: [true, "Language selection is required"],
      trim: true,
      default: "portuguese", 
    },
  },
  { timestamps: true }
);

export const LanguagePreference = mongoose.model(
  "LanguagePreference",
  languagePreferenceSchema
);