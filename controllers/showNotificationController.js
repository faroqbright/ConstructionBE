import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";

// <<< ADDED IMPORTS based on requirements & "remembered" code >>>
import { User } from "../models/user.model.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js"; // Ensure this path is correct
import { SendEmailUtil } from "../utils/emailsender.js"; // Ensure this path is correct

// <<< HELPER FUNCTIONS (inspired by "remembered" code) >>>
async function getUserLanguage(userId) {
  if (!userId) {
    console.warn("[getUserLanguage] No userId provided, defaulting to portuguese.");
    return 'portuguese';
  }
  try {
    const preference = await LanguagePreference.findOne({ userId }).lean();
    const lang = preference?.languageSelected || 'portuguese';
    // console.log(`[getUserLanguage] User ${userId} language: ${lang}`);
    return lang;
  } catch (error) {
    console.error(`[getUserLanguage] Error fetching language for user ${userId}:`, error.message);
    return 'portuguese';
  }
}

function getLocalizedContent(userLanguage, contentObject, defaultContent = '') {
  if (typeof contentObject === 'string') {
    return contentObject;
  }
  if (contentObject && typeof contentObject === 'object') {
    const plainContent = contentObject._doc ? { ...contentObject._doc } : contentObject;
    // console.log(`[getLocalizedContent] Language: ${userLanguage}, Available keys: ${Object.keys(plainContent).join(', ')}`);
    return plainContent[userLanguage] || plainContent.portuguese || plainContent.english || defaultContent;
  }
  // console.log(`[getLocalizedContent] ContentObject is not string or object, returning default: ${defaultContent}`);
  return defaultContent;
}

const createNotification = asyncHandler(async (req, res) => {
  console.log("[createNotification] Received request:", req.body);
  const {
    title,
    type,
    description,
    lengthyDesc,
    memberId,
    projectId,
  } = req.body;

  // --- Basic Validation ---
  if (!type || !memberId) {
    console.error("[createNotification] Validation Error: Type and memberId are required.");
    throw new ApiError(400, "Type and memberId are required.");
  }
  if (!title || (typeof title !== 'string' && (typeof title !== 'object' || (!title.portuguese && !title.english)))) {
    console.error("[createNotification] Validation Error: Title format invalid.", title);
    throw new ApiError(400, "Title must be a string or an object with 'portuguese' and/or 'english' keys.");
  }

  // --- ID Format Validation ---
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    console.error("[createNotification] Validation Error: Invalid memberId format:", memberId);
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    console.error("[createNotification] Validation Error: Invalid projectId format:", projectId);
    throw new ApiError(400, "Invalid project ID format.");
  }
  console.log(`[createNotification] Target memberId: ${memberId}, ProjectId: ${projectId || 'N/A'}`);

  // --- Determine User Language and Localize Content ---
  const userLanguage = await getUserLanguage(memberId);
  console.log(`[createNotification] User ${memberId} language set to: ${userLanguage}`);

  const localizedTitle = getLocalizedContent(userLanguage, title, "Notification");
  const localizedDescription = getLocalizedContent(userLanguage, description, "You have a new notification.");
  const localizedLengthyDesc = getLocalizedContent(userLanguage, lengthyDesc, "Please check your account for more details.");
  console.log(`[createNotification] Localized Title: ${localizedTitle}`);
  console.log(`[createNotification] Localized Description: ${localizedDescription}`);

  // --- 1. Create In-App Notification (ShowNotification model) ---
  const notificationData = {
    title: localizedTitle,
    type,
    description: localizedDescription,
    lengthyDesc: localizedLengthyDesc,
    memberId: new mongoose.Types.ObjectId(memberId),
    ...(projectId && { projectId: new mongoose.Types.ObjectId(projectId) }),
  };

  console.log("[createNotification] Attempting to create in-app notification with data:", notificationData);
  const inAppNotification = await ShowNotification.create(notificationData);

  if (!inAppNotification) {
    console.error("[createNotification] CRITICAL: Failed to create in-app notification in DB.");
    throw new ApiError(500, "Failed to create the in-app notification in the database.");
  }
  console.log("[createNotification] In-app notification created successfully:", inAppNotification._id.toString());

  // --- Asynchronously send Push and Email notifications ---
  (async () => {
    console.log(`[Notification Sender ${inAppNotification._id}] Starting background processing for push/email.`);
    try {
      const recipientUser = await User.findById(memberId)
        .select("_id email userName notificationToken fcmDeviceToken")
        .lean();

      if (!recipientUser) {
        console.warn(`[Notification Sender ${inAppNotification._id}] Recipient user ${memberId} NOT FOUND. Skipping push/email.`);
        return;
      }
      console.log(`[Notification Sender ${inAppNotification._id}] Found recipient: ${recipientUser.userName}, Email: ${recipientUser.email}, Token1: ${recipientUser.notificationToken}, Token2: ${recipientUser.fcmDeviceToken}`);

      let projectNameForNotif = "";
      if (projectId) {
        try {
          const project = await editProject.findById(projectId).select("projectName").lean();
          if (project && project.projectName) {
            projectNameForNotif = project.projectName;
            console.log(`[Notification Sender ${inAppNotification._id}] Fetched project name: ${projectNameForNotif}`);
          } else {
            console.warn(`[Notification Sender ${inAppNotification._id}] Project ${projectId} found but has no name, or project not found.`);
          }
        } catch (projectError) {
          console.error(`[Notification Sender ${inAppNotification._id}] Error fetching project ${projectId} details:`, projectError.message);
        }
      }

      // --- 2. Send Push Notification (via Firebase) ---
      const effectiveToken = recipientUser.notificationToken || recipientUser.fcmDeviceToken;
      if (effectiveToken) {
        console.log(`[Notification Sender ${inAppNotification._id}] Attempting to send PUSH to token: ${effectiveToken}`);
        try {
          const pushDataPayload = {
            notificationId: inAppNotification._id.toString(),
            type: type,
            ...(projectId && { projectId: projectId.toString() }),
          };
          const pushBody = localizedDescription || (userLanguage === 'portuguese' ? 'Você tem uma nova notificação.' : 'You have a new notification.');
          
          // Ensure `sendPushNotification` is correctly imported and functional
          await sendPushNotification([effectiveToken], localizedTitle, pushBody, pushDataPayload);
          console.log(`[Notification Sender ${inAppNotification._id}] PUSH notification sent successfully to ${recipientUser.userName}.`);
        } catch (pushError) {
          console.error(`[Notification Sender ${inAppNotification._id}] FAILED to send push notification to ${recipientUser.userName} (${memberId}):`, pushError.message, pushError.stack);
        }
      } else {
        console.log(`[Notification Sender ${inAppNotification._id}] No push token found for user ${recipientUser.userName} (${memberId}). Skipping push.`);
      }

      // --- 3. Send Email Notification ---
      if (recipientUser.email) {
        console.log(`[Notification Sender ${inAppNotification._id}] Attempting to send EMAIL to: ${recipientUser.email}`);
        try {
          const emailSubject = localizedTitle;
          const recipientName = recipientUser.userName || (userLanguage === 'portuguese' ? 'Utilizador' : 'User');
          const mainEmailContent = localizedLengthyDesc || localizedDescription || (userLanguage === 'portuguese' ? 'Você recebeu uma nova atualização em sua conta.' : 'You have received a new update on your account.');
          const projectInfoHtml = projectId && projectNameForNotif
            ? (userLanguage === 'portuguese' ? `<p>Relacionado ao projeto: <strong>${projectNameForNotif}</strong></p>` : `<p>Related to project: <strong>${projectNameForNotif}</strong></p>`)
            : '';
          
          let emailHtml;
          if (userLanguage === 'portuguese') {
            emailHtml = `...`; // Your Portuguese HTML template
          } else { // Default to English
            emailHtml = `...`; // Your English HTML template
          }
           // For brevity, I'm not pasting the full HTML again, but ensure it's correct
           if (userLanguage === 'portuguese') {
            emailHtml = `
              <p>Prezado(a) ${recipientName},</p>
              <p>${mainEmailContent}</p>
              ${projectInfoHtml}
              <br />
              <p>Para mais detalhes, acesse a plataforma.</p>
              <p>Atenciosamente,<br/>Equipa Soapro</p>
            `;
          } else { // Default to English
            emailHtml = `
              <p>Dear ${recipientName},</p>
              <p>${mainEmailContent}</p>
              ${projectInfoHtml}
              <br />
              <p>For more details, please log in to the platform.</p>
              <p>Best regards,<br/>The Soapro Team</p>
            `;
          }
          // Ensure `SendEmailUtil` is correctly imported and functional
          await SendEmailUtil({
            from: process.env.EMAIL_FROM || "noreply@soapro.com",
            to: recipientUser.email,
            subject: emailSubject,
            html: emailHtml,
          });
          console.log(`[Notification Sender ${inAppNotification._id}] EMAIL sent successfully to ${recipientUser.email}.`);
        } catch (emailError) {
          console.error(`[Notification Sender ${inAppNotification._id}] FAILED to send email to ${recipientUser.email}:`, emailError.message, emailError.stack);
        }
      } else {
        console.log(`[Notification Sender ${inAppNotification._id}] No email address found for user ${recipientUser.userName} (${memberId}). Skipping email.`);
      }
    } catch (backgroundError) {
      console.error(`[Notification Sender ${inAppNotification._id}] GENERAL ERROR in background push/email processing for ${memberId}:`, backgroundError.message, backgroundError.stack);
    }
  })();

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        inAppNotification,
        "In-app notification created. Push and email notifications are being processed (check server logs)."
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