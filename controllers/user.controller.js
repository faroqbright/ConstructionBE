import jwt from "jsonwebtoken";
import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { generateAccessAndRefreshTokens } from "../utils/token.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { generateOTP } from "../utils/generateOtp.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";
import { BusinessArea } from "../models/businessAreasModal.js";

const resendOTP = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(400, "User not found");

  const otp = generateOTP();
  const otpExpires = Date.now() + 300000;

  user.otp = otp;
  user.otpExpires = otpExpires;
  await user.save();

  const body = {
    from: `"Construction Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Authentication",
    html: `<h2>Hello ${email}</h2>
        <p>Your OTP is <strong>${otp}</strong></p>
        <p>If you did not initiate this request, please contact us immediately at info@soapro.ao</p>
        <p>Thank you</p>
        <strong>Developer Team</strong>`,
  };

  try {
    await SendEmailUtil(body);
    res.status(200).json({ message: "Please check your email to verify!" });
  } catch (error) {
    throw new ApiError(500, "Error sending email");
  }
});

const verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email, otp });
  if (!user || user.otpExpires < Date.now()) {
    throw new ApiError(400, "Invalid or expired OTP");
  }

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  res.status(200).json(new ApiResponse(200, { email }, "OTP verified"));
});

const registerUser = asyncHandler(async (req, res) => {
  const { email, password, fcmDeviceToken, userName } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(400, "Email is already in use");
  }

  const newUser = new User({
    email,
    password,
    userName,
    isMain: true,
    fcmDeviceToken,
  });

  await newUser.save();

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    newUser._id
  );

  const options = {
    httpOnly: true,
    secure: true, // Always true since you're using HTTPS
    sameSite: "None",
  };

  res
    .status(201)
    .cookie("accessToken", accessToken, {
      ...options,
      maxAge: 4 * 24 * 60 * 60 * 1000,
    })
    .cookie("refreshToken", refreshToken, {
      ...options,
      maxAge: 10 * 24 * 60 * 60 * 1000,
    })
    .json(
      new ApiResponse(
        201,
        { email, userName, accessToken, refreshToken },
        "User registered successfully"
      )
    );
});

const login = asyncHandler(async (req, res) => {
  const { email, password, fcmDeviceToken } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  const user = await User.findOne({ email })
    .select("+password")
    .populate("role");

  if (!user) {
    throw new ApiError(401, "Invalid credentials");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );

  user.refreshToken = refreshToken;

  if (fcmDeviceToken) {
    user.fcmDeviceToken = fcmDeviceToken;
  }

  let assignedBusinessAreas = [];
  if (user.role && user.role._id) {
    assignedBusinessAreas = await BusinessArea.find({
      role: user.role._id,
    }).select("businessArea");

    if (!user.businessArea && assignedBusinessAreas.length > 0) {
      const firstBusinessArea = assignedBusinessAreas[0]?.businessArea;
      if (firstBusinessArea) {
        user.businessArea = firstBusinessArea;
      }
    }
  }

  await user.save({ validateBeforeSave: false });

  const options = {
    httpOnly: true,
    secure: true, // Always true since you're using HTTPS
    sameSite: "None",
  };

  const loggedInUser = await User.findById(user._id)
    .select("-refreshToken")
    .populate("role");

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          assignedBusinessAreas,
          accessToken,
          refreshToken,
        },
        "User logged in successfully"
      )
    );
});

const updatePassword = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and a new password are required.");
  }

  if (password.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters long.");
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(404, "User with this email does not exist.");
  }

  user.password = password;
  user.isPasswordChanged = true;

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        {},
        "Password has been updated successfully. The user will need to log in with the new password."
      )
    );
});

const forgetPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(404, "User not found");

  const otp = generateOTP();
  const otpExpires = Date.now() + 300000;

  user.otp = otp;
  user.otpExpires = otpExpires;
  await user.save();

  const body = {
    from: `"Construction Management" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Authentication",
    html: `<h2>Hello ${email}</h2>
        <p>Your OTP is <strong>${otp}</strong></p>
        <p>If you did not initiate this request, please contact us immediately at info@soapro.ao</p>
        <p>Thank you</p>
        <strong>Developer Team</strong>`,
  };

  const message = "Please check your email to verify!";

  try {
    await SendEmailUtil(body);
    res.status(200).json({ message });
  } catch (error) {
    throw new ApiError(500, "Error sending email");
  }

  res.status(200).json(new ApiResponse(200, { email }, "OTP sent to email"));
});

const resetPassword = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) throw new ApiError(400, "User not found");

  user.password = password;
  await user.save();

  res
    .status(200)
    .json(new ApiResponse(200, { user }, "Password reset successful"));
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      new: true,
    }
  );

  const options = {
    httpOnly: true,
    secure: true, // Always true since you're using HTTPS
    sameSite: "None",
  };

  return res
    .status(200)
    .clearCookie("accessToken", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    })
    .clearCookie("refreshToken", {
      httpOnly: true,
      secure: true,
      sameSite: "None",
    })
    .json(new ApiResponse(200, {}, "User logged Out"));
});

const getUserProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();

  const user = await User.findById(userId)
    .select("-password -refreshToken")
    .populate("role");
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, user, "Account details retrieved successfully"));
});

const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  const { userName, address, phoneNumber, newPassword, email } = req.body;

  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, "User not found");
  }

  if (userName) {
    user.userName = userName;
  }
  if (address) {
    user.address = address;
  }
  if (phoneNumber) {
    user.phoneNumber = phoneNumber;
  }

  if (email) {
    const normalizedEmail = email.toLowerCase();
    if (normalizedEmail !== user.email.toLowerCase()) {
      const existingUser = await User.findOne({ email: normalizedEmail });
      if (existingUser && existingUser._id.toString() !== userId) {
        throw new ApiError(400, "Email already in use by another account");
      }
      user.email = normalizedEmail;
    }
  }

  if (newPassword) {
    if (newPassword.length < 6) {
      throw new ApiError(400, "Password must be at least 6 characters long.");
    }
    user.password = newPassword;
  }

  const { files } = req;
  if (files?.avatar?.length > 0) {
    const avatarFile = files.avatar[0];
    const avatarUrl = await uploadToS3(
      avatarFile.buffer,
      avatarFile.originalname,
      avatarFile.mimetype
    );
    if (!avatarUrl) {
      throw new ApiError(400, "Failed to upload profile image");
    }
    user.avatar = avatarUrl;
  }

  await user.save();
  const updatedUser = await User.findById(userId).select(
    "-password -refreshToken"
  );

  res
    .status(200)
    .json(
      new ApiResponse(200, updatedUser, "Account details updated successfully")
    );
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new ApiError(401, "Refresh token is missing");
  }

  const user = await User.findOne({ refreshToken });

  if (!user || !user.email.length) {
    throw new ApiError(403, "Invalid refresh token");
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    if (decoded._id !== user._id.toString()) {
      throw new ApiError(403, "Invalid refresh token");
    }

    const accessToken = user.generateAccessToken();

    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { 
            user: user,
            accessToken: accessToken,
            refreshToken: refreshToken
          },
          "Access token refreshed successfully"
        )
      );
  } catch (error) {
    throw new ApiError(403, "Invalid refresh token", error.message);
  }
});

const updateFcmToken = asyncHandler(async (req, res) => {
  const { fcmToken } = req.body;
  const userId = req.user._id;

  if (!fcmToken) {
    throw new ApiError(400, "FCM token is required");
  }

  const user = await User.findByIdAndUpdate(
    userId,
    { fcmDeviceToken: fcmToken },
    { new: true }
  ).select("-password -refreshToken");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res
    .status(200)
    .json(new ApiResponse(200, user, "FCM token updated successfully"));
});

export {
  registerUser,
  verifyOTP,
  resendOTP,
  login,
  forgetPassword,
  resetPassword,
  logoutUser,
  getUserProfile,
  updateProfile,
  refreshAccessToken,
  updateFcmToken,
  updatePassword,
};
