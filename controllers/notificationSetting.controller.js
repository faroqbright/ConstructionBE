import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
// import { User } from "../models/user.model.js"; // Optional: if you need to validate user existence strictly

/**
 * @description Get notification settings for a user. Creates default settings if none exist.
 * @route GET /api/v1/users/:userId/notification-settings
 * @access Private (User can get their own, or Admin)
 */
const getNotificationSettings = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const requestingUser = req.user; // From verifyJWT

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format.");
  }

  // Authorization: User can get their own settings, or an admin can get any user's settings
  if (requestingUser._id.toString() !== userId && !requestingUser.isAdmin) { // Assuming isAdmin field
    throw new ApiError(403, "You are not authorized to access these settings.");
  }

  let settings = await NotificationSetting.findOne({ userId });

  if (!settings) {
    // If no settings exist for the user, create them with default values
    // This ensures the frontend always gets a settings object
    try {
      settings = await NotificationSetting.create({ userId }); // Defaults will be applied from schema
    } catch (error) {
      // Handle potential unique constraint violation if another request creates it simultaneously (rare)
      if (error.code === 11000) { // Duplicate key error
        settings = await NotificationSetting.findOne({ userId });
        if (!settings) { // If still not found after a duplicate error, something is very wrong
            throw new ApiError(500, "Failed to retrieve or initialize notification settings after race condition.");
        }
      } else {
        throw new ApiError(500, "Failed to initialize notification settings for the user.");
      }
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        settings,
        "Notification settings fetched successfully."
      )
    );
});

/**
 * @description Update notification settings for a user.
 * @route PUT /api/v1/users/:userId/notification-settings
 * @access Private (User can update their own, or Admin)
 */
const updateNotificationSettings = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const requestingUser = req.user;
  const {
    projectReportsEnabled,
    projectUpdatesEnabled,
    financialUpdatesEnabled,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format.");
  }

  // Authorization
  if (requestingUser._id.toString() !== userId && !requestingUser.isAdmin) {
    throw new ApiError(403, "You are not authorized to update these settings.");
  }

  const updateData = {};
  if (typeof projectReportsEnabled === "boolean") {
    updateData.projectReportsEnabled = projectReportsEnabled;
  }
  if (typeof projectUpdatesEnabled === "boolean") {
    updateData.projectUpdatesEnabled = projectUpdatesEnabled;
  }
  if (typeof financialUpdatesEnabled === "boolean") {
    updateData.financialUpdatesEnabled = financialUpdatesEnabled;
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError(400, "No valid settings provided for update.");
  }

  // Find and update, or create if it doesn't exist (upsert)
  const settings = await NotificationSetting.findOneAndUpdate(
    { userId: userId },
    { $set: updateData },
    { new: true, upsert: true, runValidators: true }
  );

  if (!settings) {
    // This should ideally not be hit due to upsert: true
    throw new ApiError(
      500,
      "Failed to update or create notification settings."
    );
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        settings,
        "Notification settings updated successfully."
      )
    );
});

export { getNotificationSettings, updateNotificationSettings };