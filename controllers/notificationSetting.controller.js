import mongoose from "mongoose";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";

const getNotificationSettings = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const requestingUser = req.user;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format.");
  }

  if (requestingUser._id.toString() !== userId) {
    throw new ApiError(403, "You are not authorized to access these settings.");
  }

  let settings = await NotificationSetting.findOne({ userId });

  if (!settings) {
    try {
      settings = await NotificationSetting.create({ userId });
    } catch (error) {
      if (error.code === 11000) {
        settings = await NotificationSetting.findOne({ userId });
        if (!settings) {
          throw new ApiError(
            500,
            "Failed to retrieve or initialize notification settings after race condition."
          );
        }
      } else {
        throw new ApiError(
          500,
          "Failed to initialize notification settings for the user."
        );
      }
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { status: settings.status },
        "Notification status fetched successfully."
      )
    );
});

const updateNotificationSettings = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const requestingUser = req.user;
  const { status } = req.body;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format.");
  }

  if (requestingUser._id.toString() !== userId && !requestingUser.isAdmin) {
    throw new ApiError(403, "You are not authorized to update these settings.");
  }

  if (typeof status !== "boolean") {
    throw new ApiError(
      400,
      "Invalid or missing 'status' value. It must be a boolean."
    );
  }

  const settings = await NotificationSetting.findOneAndUpdate(
    { userId },
    { $set: { status } },
    { new: true, upsert: true, runValidators: true }
  );

  if (!settings) {
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
        { status: settings.status },
        "Notification status updated successfully."
      )
    );
});

export { getNotificationSettings, updateNotificationSettings };
