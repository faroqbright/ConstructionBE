import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema(
  {
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role", // Reference to the Role model
    },
    userName: {
      type: String,
      lowercase: true, // Ensures the username is stored in lowercase
      trim: true, // Removes any leading/trailing spaces
    },
    avatar: {
      type: String,
    },
    status: {
      type: String,
    },
    isMain: {
      type: Boolean,
      default: false,
    },
    isClient: {
      type: Boolean,
      default: false,
    },
    address: {
      type: String,
      lowercase: true, // Fix typo, change 'lowecase' to 'lowercase'
      trim: true, // Ensures address is also trimmed
    },
    phoneNumber: {
      type: String,
    },
    email: {
      type: String,
      lowercase: true, // Ensures the email is stored in lowercase
      trim: true, // Removes any leading/trailing spaces
    },
    password: {
      type: String,
    },
    otp: {
      type: String,
    },
    otpExpires: {
      type: Date,
    },
    refreshToken: {
      type: String,
    },
    accessToken: {
      type: String,
    },
    fcmDeviceToken: {
      type: String,
    },
    userType: {
      type: String,
      enum: ["Finance", "Production"], // Enum to limit userType to specific values
    },
    companyName: {
      type: String,
      trim: true, // Ensures companyName doesn't have leading/trailing spaces
    },
  },
  {
    timestamps: true,
  }
);

// Pre-save hook to hash password before saving it
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method to check if the password is correct
userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcrypt.compare(password, this.password);
};

// Method to generate an access token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      userName: this.userName,
    },
    process.env.ACCESS_TOKEN_SECRET,
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY,
    }
  );
};

// Method to generate a refresh token
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    {
      _id: this._id,
      email: this.email,
      userName: this.userName,
    },
    process.env.REFRESH_TOKEN_SECRET,
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY,
    }
  );
};

export const User = mongoose.model("User", userSchema);
