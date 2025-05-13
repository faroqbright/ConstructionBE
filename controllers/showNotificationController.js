import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

const createNotification = asyncHandler(async (req, res) => {
  const { title, type, description, lengthyDesc, memberId, projectId } =
    req.body;

  // Basic validation
  if (!title || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.");
  }

  // ID Format validation
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  // ✅ Check NotificationSetting.status
  const setting = await NotificationSetting.findOne({ userId: memberId });
  if (!setting || setting.status === false) {
    // ✅ Skip creating notification if disabled
    return res
      .status(200)
      .json(
        new ApiResponse(200, {}, "Notifications are disabled for this user")
      );
  }

  // Prepare data, ensuring optional fields are handled
  const notificationData = {
    title,
    type,
    description: description || "", // Default if empty
    lengthyDesc: lengthyDesc || "",
    memberId,
    ...(projectId && { projectId }), // Conditionally add projectId
  };

  const notification = await ShowNotification.create(notificationData);

  if (!notification) {
    // Should be rare if validation passes, but good practice
    throw new ApiError(500, "Failed to create notification in database.");
  }

  return res
    .status(201)
    .json(
      new ApiResponse(201, notification, "Notification created successfully")
    );
});

const getNotifications = asyncHandler(async (req, res) => {
  const { memberId, projectId, isRead } = req.query;
  const filter = {};

  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new ApiError(400, "Invalid recipient (memberId) format in query.");
    }

    // ✅ Check NotificationSetting.status
    const setting = await NotificationSetting.findOne({ userId: memberId });
    if (!setting || setting.status === false) {
      return res
        .status(200)
        .json(
          new ApiResponse(200, [], "Notifications are disabled for this user")
        );
    }

    filter.memberId = memberId;
  }

  if (projectId) {
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Invalid project ID format in query.");
    }
    filter.projectId = projectId;
  }

  if (isRead !== undefined) {
    filter.isRead = String(isRead).toLowerCase() === "true";
  }

  const notifications = await ShowNotification.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  return res
    .status(200)
    .json(
      new ApiResponse(200, notifications, "Notifications fetched successfully")
    );
});

const getNotificationById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid notification ID format.");
  }

  const notification = await ShowNotification.findById(id).lean();

  if (!notification) {
    throw new ApiError(404, "Notification not found.");
  }

  // ✅ Check NotificationSetting.status
  const setting = await NotificationSetting.findOne({
    userId: notification.memberId,
  });
  if (!setting || setting.status === false) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, {}, "Notifications are disabled for this user")
      );
  }

  if (notification.projectId) {
    const project = await editProject
      .findById(notification.projectId)
      .select("projectName projectBanner status milestones")
      .populate("projectOwners.ownerId", "userName email")
      .populate("members", "userName email")
      .lean();

    if (project) {
      notification.projectDetails = {
        name: project.projectName,
        banner: project.projectBanner,
        status: project.status,
        milestones: project.milestones,
        owners: project.projectOwners.map((owner) => ({
          id: owner.ownerId?._id,
          name: owner.ownerId?.userName,
          email: owner.ownerId?.email,
        })),
        members: project.members.map((member) => ({
          id: member._id,
          name: member.userName,
          email: member.email,
        })),
      };
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        notification,
        "Notification fetched successfully with project details"
      )
    );
});

const updateNotificationStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isRead } = req.body;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, "Invalid notification ID format.");
  }

  if (typeof isRead !== "boolean") {
    throw new ApiError(
      400,
      "Invalid input: 'isRead' field must be true or false."
    );
  }

  const existingNotification = await ShowNotification.findById(id);

  if (!existingNotification) {
    throw new ApiError(404, "Notification not found.");
  }

  // ✅ Check NotificationSetting.status
  const setting = await NotificationSetting.findOne({
    userId: existingNotification.memberId,
  });
  if (!setting || setting.status === false) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, {}, "Notifications are disabled for this user")
      );
  }

  const updatedNotification = await ShowNotification.findByIdAndUpdate(
    id,
    { $set: { isRead: isRead } },
    { new: true, runValidators: true }
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        updatedNotification,
        "Notification status updated successfully"
      )
    );
});

const clearAllNotifications = asyncHandler(async (req, res) => {
  const { memberId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid format for memberId");
  }

  // ✅ Check NotificationSetting.status
  const setting = await NotificationSetting.findOne({ userId: memberId });
  if (!setting || setting.status === false) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, {}, "Notifications are disabled for this user")
      );
  }

  const result = await ShowNotification.deleteMany({ memberId });

  if (result.deletedCount === 0) {
    return res
      .status(200)
      .json(new ApiResponse(200, {}, "No notifications found to delete"));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { deletedCount: result.deletedCount },
        "All notifications cleared successfully"
      )
    );
});

const getAllNotificationsForUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    // It's good practice to return here so the execution stops.
    // throw new ApiError(...) will be caught by asyncHandler and send a response.
    return res
      .status(400)
      .json(new ApiError(400, "Invalid User ID format in URL parameter."));
  }

  // ✅ Check NotificationSetting.status
  // ASSUMPTION: The field in NotificationSetting model linking to the user is 'user'.
  // If it's 'userId', change '{ user: userId }' back to '{ userId: userId }' or '{ userId }'.
  const setting = await NotificationSetting.findOne({ user: userId }); // <--- MODIFIED HERE

  // It's good to log what you find for debugging, especially if issues persist
  console.log(`Notification setting for user ${userId}:`, setting);

  if (!setting) {
    // If no setting document is found, it implies notifications might be off by default
    // or the user hasn't configured them. Decide on default behavior.
    // For now, treating as "disabled" if no specific setting is found.
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          [],
          "Notification settings not found for this user, assuming disabled."
        )
      );
  }

  if (setting.status === false) {
    // Explicitly disabled
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          [],
          "Notifications are explicitly disabled for this user."
        )
      );
  }

  // If settings are found and status is true (or not explicitly false), fetch notifications
  const userNotifications = await ShowNotification.find({ memberId: userId })
    .sort({ createdAt: -1 })
    .lean(); // .lean() is good for performance if you don't need Mongoose full documents

  if (!userNotifications) {
    // This case is unlikely if the query is correct, find usually returns an empty array if no docs match.
    // But, as a safeguard or if there was a DB error not caught by asyncHandler.
    console.error(
      `Failed to fetch notifications for user ${userId} despite settings being enabled.`
    );
    return res
      .status(500)
      .json(new ApiError(500, "Failed to fetch notifications."));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        userNotifications,
        userNotifications.length > 0
          ? `Notifications fetched successfully for user ${userId}`
          : `No notifications found for user ${userId}`
      )
    );
});

// --- Export all controller functions ---
export {
  createNotification,
  getNotifications,
  getNotificationById,
  updateNotificationStatus,
  clearAllNotifications,
  getAllNotificationsForUser, // Add the new function here
};
