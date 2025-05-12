import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js"
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

const createNotification = asyncHandler(async (req, res) => {
  const { title, type, description, lengthyDesc, memberId, projectId } = req.body;

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
       .json(new ApiResponse(200, {}, "Notifications are disabled for this user"));
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

/**
 * @description Get notifications (optionally filtered)
 * @route GET /api/v1/notifications
 * @access Private (Requires authenticated user - typically filtered for the user)
 */
const getNotifications = asyncHandler(async (req, res) => {
  const { memberId, projectId, isRead } = req.query;
  const filter = {};
  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new ApiError(400, "Invalid recipient (memberId) format in query.");
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

  // Find notification and populate basic fields
  const notification = await ShowNotification.findById(id).lean();

  if (!notification) {
    throw new ApiError(404, "Notification not found.");
  }

  // If notification has a projectId, fetch and attach project details
  if (notification.projectId) {
    const project = await editProject
      .findById(notification.projectId)
      .select("projectName projectBanner status milestones")
      .populate("projectOwners.ownerId", "userName email")
      .populate("members", "userName email")
      .lean();

    if (project) {
      // Attach project details to the notification response
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

  // Validate isRead input
  if (typeof isRead !== "boolean") {
    throw new ApiError(
      400,
      "Invalid input: 'isRead' field must be true or false."
    );
  }

  const updatedNotification = await ShowNotification.findByIdAndUpdate(
    id,
    { $set: { isRead: isRead } },
    { new: true, runValidators: true }
  );

  if (!updatedNotification) {
    throw new ApiError(404, "Notification not found.");
  }

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


const clearAllNotifications = asyncHandler (async (req, res) => {
  const { memberId } = req.params

  if (!mongoose.Types.ObjectId.isValid(memberId)){
    throw new Error (400, "Invalid format for memberId")
  }

  const result = await ShowNotification.deleteMany({ memberId })

  if ( result.deletedCount === 0) {
    return res.status(200).json(new ApiResponse(200, {}, "No notifications found to delete"));
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
})


const getAllNotificationsForUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;

  // 1. Validate userId format
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new ApiError(400, "Invalid User ID format in URL parameter.");
  }

  // 2. Fetch notifications for the given userId (assuming userId maps to 'memberId' in your schema)
  //    Sort by newest first. Using .lean() for performance if you don't need Mongoose model instances.
  const userNotifications = await ShowNotification.find({ memberId: userId })
    .sort({ createdAt: -1 })
    .lean(); // Use .lean() if you don't need Mongoose documents

  // 3. Optional: If no notifications are found, you might want to return an empty array
  //    or a specific message, but an empty array is standard for "no results".
  //    The current setup will correctly return an empty array.

  // 4. Respond with the notifications
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        userNotifications,
        `Notifications fetched successfully for user ${userId}`
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
