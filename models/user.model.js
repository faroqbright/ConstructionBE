import mongoose from "mongoose";
import bcryptjs from "bcryptjs"; // Corrected import
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema(
  {
    role: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Role",
    },
    userName: {
      type: String,
      lowercase: true,
      trim: true,
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
      lowercase: true,
      trim: true,
    },
    phoneNumber: {
      type: String,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      select: false,
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
    notificationToken: {
      type: String,
      default: null,
      index: true,
    },
    fcmDeviceToken: {
      type: String,
      default: null,
    },
    userType: {
      type: String,
      enum: ["Finance", "Production"],
    },
    companyName: {
      type: String,
      trim: true,
    },
    businessArea: {
      type: String,
    },
    isPasswordChanged: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Hashes password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  // ✨ --- CHANGE 2: Using bcryptjs consistently ---
  this.password = await bcryptjs.hash(this.password, 10);
  next();
});


userSchema.methods.isPasswordCorrect = async function (password) {
  return await bcryptjs.compare(password, this.password);
};

// Method to generate an access token
userSchema.methods.generateAccessToken = function () {
  return jwt.sign(
    { _id: this._id, email: this.email, userName: this.userName },
    process.env.ACCESS_TOKEN_SECRET,
    { expiresIn: process.env.ACCESS_TOKEN_EXPIRY }
  );
};

// Method to generate a refresh token
userSchema.methods.generateRefreshToken = function () {
  return jwt.sign(
    { _id: this._id, email: this.email, userName: this.userName },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRY }
  );
};

// Method to update notification token
userSchema.methods.updateNotificationToken = async function (token) {
  this.notificationToken = token;
  this.fcmDeviceToken = token;
  await this.save();
  return this;
};

export const User = mongoose.model("User", userSchema);
