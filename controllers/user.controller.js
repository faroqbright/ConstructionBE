import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { generateAccessAndRefreshTokens } from "../utils/token.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { generateOTP } from "../utils/generateOtp.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";



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
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Authentication",
    html: `<h2>Hello ${email}</h2>
        <p>Your OTP is <strong>${otp}</strong></p>
        <p>If you did not initiate this request, please contact us immediately at eg@.com</p>
        <p>Thank you</p>
        <strong>Developer Team</strong>`,
  };

  const message = "Please check your email to verify!";

  try {
    await SendEmailUtil(body);
    res.status(200).json({ message });
  } catch (error) {
    console.error("Error sending email:", error.message);
    throw new ApiError(500, "Error sending email");
  }

  res.status(200).json(new ApiResponse(200, { email }, "OTP resent to email"));
});

const verifyOTP = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  const user = await User.findOne({ email, otp });
  if (!user || user.otpExpires < Date.now())
    throw new ApiError(400, "Invalid or expired OTP");

  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save();

  res.status(200).json(new ApiResponse(200, { email }, "OTP verified"));
});


const registerUser = asyncHandler(async (req, res) => {
  const { email, password, fcmDeviceToken, userName } = req.body;
  console.log("🚀 ~ registerUser ~ req.body:", req.body);

  // Check if the user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new ApiError(400, "Email is already in use");
  }

  const newUser = new User({
    email,
    password,
    userName, // Store userName
    isMain: true,
    fcmDeviceToken,
  });

  await newUser.save();

  // Generate access and refresh tokens
  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    newUser._id
  );

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  };

  res
    .status(201)
    .cookie("accessToken", accessToken, { ...options, maxAge: 4 * 24 * 60 * 60 * 1000 })
    .cookie("refreshToken", refreshToken, {
      ...options,
      maxAge: 10 * 24 * 60 * 60 * 1000,
    })
    .json(
      new ApiResponse(201, { email, userName, accessToken, refreshToken }, "User registered successfully")
    );
});

const login = asyncHandler(async (req, res) => {

  const { email, password, fcmDeviceToken } = req.body;

  if (!email) {
    throw new ApiError(400, "email is required");
  }

  const user = await User.findOne({
    $or: [{ email }],
  });

  if (!user) {
    throw new ApiError(404, "User does not exist");
  }

  const isPasswordValid = await user.isPasswordCorrect(password);

  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(
    user._id
  );
  user.fcmDeviceToken = fcmDeviceToken;
  await user.save();
  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  ).populate("role");

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User logged in successfully"
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
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Authentication",
    html: `<h2>Hello ${email}</h2>
        <p>Your OTP is <strong>${otp}</strong></p>
        <p>If you did not initiate this request, please contact us immediately at eg@.com</p>
        <p>Thank you</p>
        <strong>Developer Team</strong>`,
  };

  const message = "Please check your email to verify!";

  try {
    await SendEmailUtil(body);
    res.status(200).json({ message });
  } catch (error) {
    console.error("Error sending email:", error.message);
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
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged Out"));
});
const getUserProfile = asyncHandler(async (req, res) => {
  const userId = req.user._id.toString();


  const user = await User.findById(userId).select("-password -refreshToken").populate("role");
  if (!user) {
    throw new ApiError(404, "User not found", [], { user: "User not found" });
  }


  res.status(200).json(new ApiResponse(200, user, "Account details updated successfully"));
});
const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user.id.toString();

  const { email, userName, phoneNumber, address } = req.body;


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

  const { body, files } = req;
  console.log("🚀 ~ updateProfile ~ files:", files)

  let avatarLocalPath;
  if (files && Array.isArray(files.avatar) && files.avatar.length > 0) {
    avatarLocalPath = files.avatar[0].path;
  }
  console.log("🚀 ~ updateProfile ~ avatarLocalPath:", avatarLocalPath)

  let avatar;
  if (files && files.avatar && Array.isArray(files.avatar) && files.avatar.length > 0) {
    // Use the buffer directly if you are uploading to S3
    const avatarFile = files.avatar[0];

    // Assuming uploadToS3 expects a buffer, file name, and mimetype
    avatar = await uploadToS3(avatarFile.buffer, avatarFile.originalname, avatarFile.mimetype);
    console.log("🚀 ~ updateProfile ~ avatar:", avatar);

    if (!avatar) {
      throw new ApiError(400, "Failed to upload profile image", [], { avatar: "Failed to upload profile image" });
    }
  }

  const updateData = { ...body };
  if (avatar) {
    user.avatar = avatar;
  }
  await user.save();

  res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});
const refreshAccessToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.cookies;
  console.log(refreshToken);

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
      .cookie("accessToken", accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Strict",
        maxAge: 15 * 60 * 1000, // 15 minutes
      })
      .json(new ApiResponse(200, { data: user }, "Access token refreshed successfully"));
  } catch (error) {
    console.error("Error verifying token:", error.message);
    throw new ApiError(403, "Invalid refresh token", error.message);
  }
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
  refreshAccessToken
};
