// Original imports
import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

import { User } from "../models/user.model.js";  
import { LanguagePreference } from "../models/languagePreferenceSchema.js";  
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";  
import { SendEmailUtil } from "../utils/emailsender.js";  

async function getUserLanguage(userId) {
  if (!userId) return 'portuguese'; 
  try {
    const preference = await LanguagePreference.findOne({ userId }).lean();
    return preference?.languageSelected || 'portuguese';
  } catch (error) {
    console.error(`[NotificationUtil] Error fetching language preference for user ${userId}:`, error.message);
    return 'portuguese'; 
  }
}

function getLocalizedContent(userLanguage, contentObject, defaultContent = '') {
  if (typeof contentObject === 'string') {
    return contentObject; 
  }
  if (contentObject && typeof contentObject === 'object') {
    const plainContent = contentObject._doc ? { ...contentObject._doc } : contentObject;
    return plainContent[userLanguage] || plainContent.portuguese || plainContent.english || defaultContent;
  }
  return defaultContent; 
}

const createNotification = asyncHandler(async (req, res) => {
  const {
    title, 
    type,
    description,  
    lengthyDesc,  
    memberId, 
    projectId, 
  } = req.body;

  if (!type || !memberId) {  
    throw new ApiError(400, "Type and memberId are required.");
  }
  if (!title || (typeof title !== 'string' && (typeof title !== 'object' || (!title.portuguese && !title.english)))) {
    throw new ApiError(400, "Title must be a string or an object with 'portuguese' and/or 'english' keys.");
  }

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  const userLanguage = await getUserLanguage(memberId);

  const localizedTitle = getLocalizedContent(userLanguage, title, "Notification");  
  const localizedDescription = getLocalizedContent(userLanguage, description);
  const localizedLengthyDesc = getLocalizedContent(userLanguage, lengthyDesc);

  const notificationData = {
    title: localizedTitle,
    type,
    description: localizedDescription,
    lengthyDesc: localizedLengthyDesc,
    memberId: new mongoose.Types.ObjectId(memberId),  
    ...(projectId && { projectId: new mongoose.Types.ObjectId(projectId) }), 
  };

  const inAppNotification = await ShowNotification.create(notificationData);

  if (!inAppNotification) {
    throw new ApiError(500, "Failed to create the in-app notification in the database.");
  }

  (async () => {
    try {
      const recipientUser = await User.findById(memberId)
        .select("_id email userName notificationToken fcmDeviceToken")  
        .lean();

      if (!recipientUser) {
        console.warn(`[Notification Background] Recipient user ${memberId} not found. Skipping push/email notifications.`);
        return;
      }

      let projectNameForNotif = "";  
      if (projectId) {
        try {
          const project = await editProject.findById(projectId).select("projectName").lean();
          if (project && project.projectName) {
            projectNameForNotif = project.projectName;
          }
        } catch (projectError) {
          console.error(`[Notification Background] Error fetching project ${projectId} details:`, projectError.message);
        }
      }

      // --- 2. Send Push Notification (via Firebase) ---
      const effectiveToken = recipientUser.notificationToken || recipientUser.fcmDeviceToken;
      if (effectiveToken) {
        try {
          const pushDataPayload = {
            notificationId: inAppNotification._id.toString(),  
            type: type,
            ...(projectId && { projectId: projectId.toString() }),
          };
          const pushBody = localizedDescription || (userLanguage === 'portuguese' ? 'Você tem uma nova notificação.' : 'You have a new notification.');
          
          await sendPushNotification([effectiveToken], localizedTitle, pushBody, pushDataPayload);
        } catch (pushError) {
          console.error(`[Notification Background] Failed to send push notification to ${memberId} (${recipientUser.userName}):`, pushError.message);
        }
      } else {
      }

      // --- 3. Send Email Notification ---
      if (recipientUser.email) {
        try {
          const emailSubject = localizedTitle;
          const recipientName = recipientUser.userName || (userLanguage === 'portuguese' ? 'Utilizador' : 'User');
          const mainEmailContent = localizedLengthyDesc || localizedDescription || (userLanguage === 'portuguese' ? 'Você recebeu uma nova atualização em sua conta.' : 'You have received a new update on your account.');
          const projectInfoHtml = projectId && projectNameForNotif
            ? (userLanguage === 'portuguese' ? `<p>Relacionado ao projeto: <strong>${projectNameForNotif}</strong></p>` : `<p>Related to project: <strong>${projectNameForNotif}</strong></p>`)
            : '';
          
          let emailHtml;
          if (userLanguage === 'portuguese') {
            emailHtml = `
              <p>Prezado(a) ${recipientName},</p>
              <p>${mainEmailContent}</p>
              ${projectInfoHtml}
              <br />
              <p>Para mais detalhes, acesse a plataforma.</p>
              <p>Atenciosamente,<br/>Equipa Soapro</p>
            `;
          } else { 
            emailHtml = `
              <p>Dear ${recipientName},</p>
              <p>${mainEmailContent}</p>
              ${projectInfoHtml}
              <br />
              <p>For more details, please log in to the platform.</p>
              <p>Best regards,<br/>The Soapro Team</p>
            `;
          }

          await SendEmailUtil({
            from: process.env.EMAIL_FROM || "noreply@soapro.com",  
            to: recipientUser.email,
            subject: emailSubject,
            html: emailHtml,
          });
        } catch (emailError) {
          console.error(`[Notification Background] Failed to send email to ${recipientUser.email}:`, emailError.message);
        }
      } else {
      }
    } catch (backgroundError) {
      console.error(`[Notification Background] General error processing push/email for ${memberId}:`, backgroundError.message);
    }
  })();  

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        inAppNotification,
        "In-app notification created. Push and email notifications are being processed."
      )
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
  getAllNotificationsForUser,
};