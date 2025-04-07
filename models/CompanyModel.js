import mongoose from "mongoose";
import { User } from "./user.model";

const companySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    number: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      default: "active",
    },
  },
  {
    timestamps: true,
  }
);

companySchema.pre("deleteOne", { document: true, query: false }, async function (next) {
  try {
    await User.deleteMany({ companyName: this.name });
    console.log(`Deleted all users associated with company: ${this.name}`);
    next();
  } catch (error) {
    next(error);
  }
});

export const Company = mongoose.model("Company", companySchema);