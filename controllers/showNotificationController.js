import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import { SendEmailUtil } from "../utils/emailsender.js"
import { User } from "../models/user.model.js"
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js"
import { LanguagePreference } from "../models/languagePreferenceSchema.js"

async function getUserLanguage(userId) {
  try {
    const preference = await LanguagePreference.findOne({ userId }).lean()
    return preference?.languageSelected || "portuguese" // Default to Portuguese
  } catch (error) {
    console.error("Error getting user language:", error)
    return "portuguese" // Default to Portuguese on error
  }
}

const createNotification = asyncHandler(async (req, res) => {
  const { title, type, description, lengthyDesc, memberId, projectId } = req.body

  // Basic validation
  if (!title || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.")
  }

  // ID Format validation
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.")
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.")
  }

  try {
    // Get user language preference
    const userLanguage = await getUserLanguage(memberId)

    // Prepare notification data with language-specific content
    const notificationData = {
      title: typeof title === "object" ? title[userLanguage] || title.portuguese || title : title,
      type,
      description:
        typeof description === "object"
          ? description[userLanguage] || description.portuguese || description
          : description || "",
      lengthyDesc:
        typeof lengthyDesc === "object"
          ? lengthyDesc[userLanguage] || lengthyDesc.portuguese || lengthyDesc
          : lengthyDesc || "",
      memberId,
      ...(projectId && { projectId }), // Conditionally add projectId
    }

    const notification = await ShowNotification.create(notificationData)

    if (!notification) {
      // Should be rare if validation passes, but good practice
      throw new ApiError(500, "Failed to create notification in database.")
    }

    // Send push notification if applicable
    if (type.includes("Milestone") || type.includes("Project")) {
      const user = await User.findById(memberId).select("notificationToken fcmDeviceToken email userName").lean()

      if (user) {
        // Send push notification if token exists
        if (user.notificationToken || user.fcmDeviceToken) {
          const token = user.notificationToken || user.fcmDeviceToken

          // Get project name if projectId exists
          let projectName = ""
          if (projectId) {
            const project = await editProject.findById(projectId).select("projectName").lean()
            if (project) {
              projectName = project.projectName
            }
          }

          // Prepare push notification content
          const pushTitle = typeof title === "object" ? title[userLanguage] || title.portuguese : title

          const pushBody =
            typeof description === "object"
              ? description[userLanguage] || description.portuguese
              : description ||
                (userLanguage === "portuguese"
                  ? `Nova notificação no ${projectName || "sistema"}`
                  : `New notification in ${projectName || "the system"}`)

          // Send push notification
          await sendPushNotification([token], pushTitle, pushBody, {
            type,
            notificationId: notification._id.toString(),
            ...(projectId && { projectId: projectId.toString() }),
          })
        }

        // Send email notification if email exists
        if (user.email && (type.includes("Milestone") || type.includes("Project") || type.includes("Task"))) {
          const emailSubject = typeof title === "object" ? title[userLanguage] || title.portuguese : title

          const emailBody =
            typeof lengthyDesc === "object"
              ? lengthyDesc[userLanguage] || lengthyDesc.portuguese
              : lengthyDesc ||
                (userLanguage === "portuguese"
                  ? `Prezado(a) ${user.userName},<br>Você recebeu uma nova notificação no sistema Soapro.<br><br>Atenciosamente,<br>Equipe Soapro`
                  : `Dear ${user.userName},<br>You have received a new notification in the Soapro system.<br><br>Best regards,<br>Soapro Team`)

          // Format email HTML
          const html = `<p>${emailBody.split("//").join("<br>")}</p>`

          // Send email
          await SendEmailUtil({
            from: process.env.EMAIL_FROM || "noreply@soapro.com",
            to: user.email,
            subject: emailSubject,
            html,
          })
        }
      }
    }

    return res.status(201).json(new ApiResponse(201, notification, "Notification created successfully"))
  } catch (error) {
    console.error("Error in createNotification:", error)
    throw new ApiError(500, "Failed to create and send notification: " + error.message)
  }
})

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
  // const setting = await NotificationSetting.findOne({
  //   userId: notification.memberId,
  // });
  // if (!setting || setting.status === false) {
  //   return res
  //     .status(200)
  //     .json(
  //       new ApiResponse(200, {}, "Notifications are disabled for this user")
  //     );
  // }

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
  // const setting = await NotificationSetting.findOne({
  //   userId: existingNotification.memberId,
  // });
  // if (!setting || setting.status === false) {
  //   return res
  //     .status(200)
  //     .json(
  //       new ApiResponse(200, {}, "Notifications are disabled for this user")
  //     );
  // }

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
  // const setting = await NotificationSetting.findOne({ userId: memberId });
  // if (!setting || setting.status === false) {
  //   return res
  //     .status(200)
  //     .json(
  //       new ApiResponse(200, {}, "Notifications are disabled for this user")
  //     );
  // }

  const result = await ShowNotification.deleteMany({
    memberId: new mongoose.Types.ObjectId(memberId),
  });

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
    throw new ApiError(400, "Invalid User ID format in URL parameter.");
  }

  // ✅ Check NotificationSetting.status
  const setting = await NotificationSetting.findOne({ userId });
  if (!setting || setting.status === false) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, [], "Notifications are disabled for this user")
      );
  }

  const userNotifications = await ShowNotification.find({ memberId: userId })
    .sort({ createdAt: -1 })
    .lean();

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
