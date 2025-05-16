import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";
import { User } from "../models/user.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";

// Helper function to get user language preference with better error handling
async function getUserLanguage(userId) {
  try {
    const preference = await LanguagePreference.findOne({ userId }).lean();
    return preference?.languageSelected || 'portuguese';
  } catch (error) {
    console.error(`Error getting language preference for user ${userId}:`, error);
    return 'portuguese'; // Fallback to Portuguese
  }
}

const createNotification = asyncHandler(async (req, res) => {
  const { title, type, description, lengthyDesc, memberId, projectId } = req.body;

  // Basic validation (unchanged from your original)
  if (!title || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.");
  }

  // ID Format validation (unchanged from your original)
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  // Get user details including notification preferences
  let user;
  try {
    user = await User.findById(memberId)
      .select("notificationToken fcmDeviceToken email userName notificationEnabled")
      .lean();
    
    if (!user) {
      throw new ApiError(404, "User not found.");
    }
  } catch (error) {
    console.error("Error fetching user details:", error);
    throw new ApiError(500, "Error fetching user information.");
  }

  // Skip if notifications are disabled for this user
  if (user.notificationEnabled === false) {
    return res
      .status(200)
      .json(
        new ApiResponse(200, {}, "Notifications are disabled for this user")
      );
  }

  // Get user's language preference
  const userLanguage = await getUserLanguage(memberId);
  const isPortuguese = userLanguage === 'portuguese';

  // Localization function with proper fallbacks
  const localize = (content) => {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (typeof content === 'object') {
      return content[userLanguage] || content.portuguese || content.english || '';
    }
    return String(content);
  };

  // Prepare localized content
  const localizedTitle = localize(title);
  const localizedDescription = localize(description);
  const localizedLengthyDesc = localize(lengthyDesc);

  // Prepare data for in-app notification (same structure as before)
  const notificationData = {
    title: localizedTitle,
    type,
    description: localizedDescription,
    lengthyDesc: localizedLengthyDesc,
    memberId,
    ...(projectId && { projectId }),
  };

  // Create in-app notification (unchanged logic)
  let notification;
  try {
    notification = await ShowNotification.create(notificationData);
    if (!notification) {
      throw new ApiError(500, "Failed to create notification in database.");
    }
  } catch (error) {
    console.error("Error creating notification:", error);
    throw new ApiError(500, "Failed to create notification.");
  }

  // Send push notification if enabled and token exists
  const pushToken = user.notificationToken || user.fcmDeviceToken;
  if (pushToken) {
    try {
      await sendPushNotification(
        [pushToken],
        localizedTitle,
        localizedDescription,
        {
          notificationId: notification._id.toString(),
          type,
          ...(projectId && { projectId: projectId.toString() }),
        }
      );
      console.log(`Push notification sent to user ${memberId}`);
    } catch (error) {
      console.error(`Failed to send push notification to user ${memberId}:`, error);
      // Continue even if push notification fails
    }
  } else {
    console.log(`No push token available for user ${memberId}`);
  }

  // Send email notification if enabled and email exists
  if (user.email) {
    try {
      const emailSubject = isPortuguese
        ? `Nova Notificação: ${localizedTitle}`
        : `New Notification: ${localizedTitle}`;
      
      const emailHtml = isPortuguese
        ? `
          <p>Prezado(a) <strong>${user.userName || 'Usuário'}</strong>,</p>
          <p>Você recebeu uma nova notificação:</p>
          <h3>${localizedTitle}</h3>
          ${localizedDescription ? `<p>${localizedDescription}</p>` : ''}
          ${localizedLengthyDesc ? `<p>${localizedLengthyDesc}</p>` : ''}
          <br/>
          <p>Atenciosamente,<br/>Equipe Soapro</p>
        `
        : `
          <p>Dear <strong>${user.userName || 'User'}</strong>,</p>
          <p>You have received a new notification:</p>
          <h3>${localizedTitle}</h3>
          ${localizedDescription ? `<p>${localizedDescription}</p>` : ''}
          ${localizedLengthyDesc ? `<p>${localizedLengthyDesc}</p>` : ''}
          <br/>
          <p>Best regards,<br/>Soapro Team</p>
        `;

      await SendEmailUtil({
        from: process.env.EMAIL_FROM || "noreply@soapro.com",
        to: user.email,
        subject: emailSubject,
        html: emailHtml,
      });
      console.log(`Email notification sent to ${user.email}`);
    } catch (error) {
      console.error(`Failed to send email to ${user.email}:`, error);
      // Continue even if email fails
    }
  } else {
    console.log(`No email available for user ${memberId}`);
  }

  // Return success response (unchanged from your original)
  return res
    .status(201)
    .json(
      new ApiResponse(201, notification, "Notification created successfully")
    );
});

// const createNotification = asyncHandler(async (req, res) => {
//   const { title, type, description, lengthyDesc, memberId, projectId } =
//     req.body;

//   // Basic validation
//   if (!title || !type || !memberId) {
//     throw new ApiError(400, "Title, type, and memberId are required.");
//   }

//   // ID Format validation
//   if (!mongoose.Types.ObjectId.isValid(memberId)) {
//     throw new ApiError(400, "Invalid recipient (memberId) format.");
//   }
//   if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
//     throw new ApiError(400, "Invalid project ID format.");
//   }

//   // ✅ Check NotificationSetting.status
//   // const setting = await NotificationSetting.findOne({ userId: memberId });
//   // if (!setting || setting.status === false) {
//   //   // ✅ Skip creating notification if disabled
//   //   return res
//   //     .status(200)
//   //     .json(
//   //       new ApiResponse(200, {}, "Notifications are disabled for this user")
//   //     );
//   // }

//   // Prepare data, ensuring optional fields are handled
//   const notificationData = {
//     title,
//     type,
//     description: description || "", // Default if empty
//     lengthyDesc: lengthyDesc || "",
//     memberId,
//     ...(projectId && { projectId }), // Conditionally add projectId
//   };

//   const notification = await ShowNotification.create(notificationData);

//   if (!notification) {
//     // Should be rare if validation passes, but good practice
//     throw new ApiError(500, "Failed to create notification in database.");
//   }

//   return res
//     .status(201)
//     .json(
//       new ApiResponse(201, notification, "Notification created successfully")
//     );
// });

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
