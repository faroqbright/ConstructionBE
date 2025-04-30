import { ShowNotification } from "../models/showNotificationSchema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

/**
 * @description Create a new notification
 * @route POST /api/v1/notifications
 * @access Private (Requires authenticated user - handled by middleware)
 */
const createNotification = asyncHandler(async (req, res) => {
  const { title, type, description, memberId, projectId } = req.body;


  if (!title || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.");
  }

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient ID format.");
  }

  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  const notificationData = {
    title,
    type,
    description: description || "", // Default to empty string if not provided
    memberId,
    ...(projectId && { projectId }), 
  };

  const notification = await ShowNotification.create(notificationData);

  if (!notification) {
    // This case might be rare with mongoose create unless validation fails upstream
    throw new ApiError(500, "Failed to create notification. Please try again.");
  }


  res
    .status(201)
    .json(
      new ApiResponse(201, notification, "Notification created successfully")
    );
});

/**
 * @description Get notifications (optionally filtered by recipient, project, or read status)
 * @route GET /api/v1/notifications
 * @access Private (Requires authenticated user - handled by middleware)
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { memberId, projectId, isRead } = req.query;

  const filter = {};

  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new ApiError(400, "Invalid recipient ID format.");
    }
    filter.memberId = memberId;
  }

  if (projectId) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Invalid project ID format.");
    }
    filter.projectId = projectId;
  }

  if (isRead !== undefined) {
    filter.isRead = isRead === "true";
  }

  const notifications = await ShowNotification.find(filter).sort({
    createdAt: -1,
  });

  res
    .status(200)
    .json(
      new ApiResponse(200, notifications, "Notifications fetched successfully")
    );
});

export { createNotification, getNotifications };
