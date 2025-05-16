import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import mongoose from "mongoose";
import { SendEmailUtil } from "../utils/emailsender.js";
import { sendNotification as sendPushNotificationFirebase } from "../utils/firebase.service.js"; // Renamed
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

// Helper function to get language preference for a single user (simplified from your example)
async function getUserLanguagePreference(userId) {
  if (!userId) return 'portuguese'; // Default
  try {
    const objectIdUserId = new mongoose.Types.ObjectId(userId);
    const preference = await LanguagePreference.findOne({ userId: objectIdUserId }).lean();
    return preference?.languageSelected || 'portuguese'; // Default if not found
  } catch (error) {
    // console.warn(`Invalid ObjectId string for language preference: ${userId}`);
    return 'portuguese'; // Default on error
  }
}

const createNotification = asyncHandler(async (req, res) => {
  const {
    title: requestTitle, // Renamed to avoid clash with generated title
    type,
    description: requestDescription, // Renamed
    lengthyDesc: requestLengthyDesc, // Renamed
    memberId, // Recipient ID
    projectId,
  } = req.body;

  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "a system process"; // Or "an administrator"

  // --- Basic Validation ---
  if (!requestTitle || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.");
  }
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  // --- Fetch Recipient User Details ---
  const recipientUser = await User.findById(memberId)
    .select("_id userName email notificationToken fcmDeviceToken")
    .lean();

  if (!recipientUser) {
    throw new ApiError(404, "Recipient user (memberId) not found.");
  }

  // --- Check NotificationSetting.status for the recipient ---
  const setting = await NotificationSetting.findOne({ userId: recipientUser._id });
  if (setting && setting.status === false) {
    // Only create in-app if that's the desired behavior even if global notifications are off.
    // For now, if settings are off, we assume no notification of any kind is desired.
    // If you want to still create the ShowNotification entry, this logic needs adjustment.
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {},
          "Notifications are disabled for this user. No notification created or sent."
        )
      );
  }

  // --- Fetch Language Preference for Recipient ---
  const recipientLang = await getUserLanguagePreference(recipientUser._id);

  // --- Fetch Project Details (if projectId is provided) ---
  let project = null;
  let projectNameForMsg = "";
  if (projectId) {
    project = await editProject.findById(projectId).select("projectName").lean();
    if (project) {
      projectNameForMsg = project.projectName;
    } else {
      // console.warn(`[CreateNotification] Project with ID ${projectId} not found, but proceeding.`);
      // Decide if this should be an error or just a warning.
      // For now, notification will proceed without project name in messages if project not found.
    }
  }

  // --- Prepare Localized Content for In-App, Push, and Email ---
  let inAppTitle, inAppDescription, inAppLengthyDesc;
  let pushTitles, pushBodies;
  let emailSubject, emailHtmlBody;

  // Use requestTitle, requestDescription, requestLengthyDesc as the core content
  const baseTitle = requestTitle;
  const baseDescription = requestDescription || "";
  const baseLengthyDesc = requestLengthyDesc || baseDescription; // Fallback for lengthyDesc

  if (recipientLang === "english") {
    inAppTitle = project
      ? `Notification for "${projectNameForMsg}": ${baseTitle}`
      : `Notification: ${baseTitle}`;
    inAppDescription = project
      ? `${baseDescription} (Project: "${projectNameForMsg}"). Triggered by ${performingUserName}.`
      : `${baseDescription}. Triggered by ${performingUserName}.`;
    inAppLengthyDesc = project
      ? `${baseLengthyDesc}\n\nThis notification is regarding project "${projectNameForMsg}" and was initiated by ${performingUserName}.\nBest regards,\nSoapro Team`
      : `${baseLengthyDesc}\n\nThis notification was initiated by ${performingUserName}.\nBest regards,\nSoapro Team`;

    pushTitles = {
      english: project ? `Project ${projectNameForMsg}: ${baseTitle}` : `New Notification: ${baseTitle}`,
      portuguese: "", // Will be filled below if needed, but only English is sent for this user
    };
    pushBodies = {
      english: project
        ? `${baseDescription.substring(0,100)}... (Project: ${projectNameForMsg}) by ${performingUserName}`
        : `${baseDescription.substring(0,100)}... by ${performingUserName}`,
      portuguese: "",
    };

    emailSubject = project
      ? `Notification regarding ${projectNameForMsg}: ${baseTitle}`
      : `Important Notification: ${baseTitle}`;
    emailHtmlBody = `
      <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Notification</title></head>
      <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
        <tr><td style="padding: 20px; text-align: center;">
          <h2 style="color: #333;">${baseTitle}</h2>
          <p style="font-size: 16px; color: #555;">Dear <strong>${recipientUser.userName || "User"}</strong>,</p>
          <p style="font-size: 16px; color: #555;">${baseDescription}</p>
          ${project ? `<p style="font-size: 16px; color: #555;">This concerns project: <strong>"${projectNameForMsg}"</strong>.</p>` : ""}
          <p style="font-size: 16px; color: #555;">This notification was triggered by ${performingUserName}.</p>
          ${baseLengthyDesc !== baseDescription ? `<p style="font-size: 16px; color: #555; margin-top:15px; border-top:1px solid #eee; padding-top:15px;"><strong>Details:</strong><br>${baseLengthyDesc.replace(/\n/g, "<br>")}</p>` : ""}
          <p style="font-size: 14px; color: #999; margin-top: 30px;">Best regards,<br><strong>Soapro Team</strong></p>
        </td></tr>
      </table></body></html>`;
  } else { // Portuguese (or default)
    inAppTitle = project
      ? `Notificação para "${projectNameForMsg}": ${baseTitle}`
      : `Notificação: ${baseTitle}`;
    inAppDescription = project
      ? `${baseDescription} (Projecto: "${projectNameForMsg}"). Despoletado por ${performingUserName}.`
      : `${baseDescription}. Despoletado por ${performingUserName}.`;
    inAppLengthyDesc = project
      ? `${baseLengthyDesc}\n\nEsta notificação é referente ao projecto "${projectNameForMsg}" e foi iniciada por ${performingUserName}.\nCom os melhores cumprimentos,\nEquipa Soapro`
      : `${baseLengthyDesc}\n\nEsta notificação foi iniciada por ${performingUserName}.\nCom os melhores cumprimentos,\nEquipa Soapro`;

    pushTitles = {
      english: "",
      portuguese: project ? `Projecto ${projectNameForMsg}: ${baseTitle}` : `Nova Notificação: ${baseTitle}`,
    };
    pushBodies = {
      english: "",
      portuguese: project
        ? `${baseDescription.substring(0,100)}... (Projecto: ${projectNameForMsg}) por ${performingUserName}`
        : `${baseDescription.substring(0,100)}... por ${performingUserName}`,
    };
    emailSubject = project
      ? `Notificação referente a ${projectNameForMsg}: ${baseTitle}`
      : `Notificação Importante: ${baseTitle}`;
    emailHtmlBody = `
      <!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Notificação</title></head>
      <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
        <tr><td style="padding: 20px; text-align: center;">
          <h2 style="color: #333;">${baseTitle}</h2>
          <p style="font-size: 16px; color: #555;">Caro(a) <strong>${recipientUser.userName || "Utilizador"}</strong>,</p>
          <p style="font-size: 16px; color: #555;">${baseDescription}</p>
          ${project ? `<p style="font-size: 16px; color: #555;">Diz respeito ao projecto: <strong>"${projectNameForMsg}"</strong>.</p>` : ""}
          <p style="font-size: 16px; color: #555;">Esta notificação foi despoletada por ${performingUserName}.</p>
          ${baseLengthyDesc !== baseDescription ? `<p style="font-size: 16px; color: #555; margin-top:15px; border-top:1px solid #eee; padding-top:15px;"><strong>Detalhes:</strong><br>${baseLengthyDesc.replace(/\n/g, "<br>")}</p>` : ""}
          <p style="font-size: 14px; color: #999; margin-top: 30px;">Com os melhores cumprimentos,<br><strong>Equipa Soapro</strong></p>
        </td></tr>
      </table></body></html>`;
  }

  // --- Create In-App Notification ---
  const notificationData = {
    title: inAppTitle,
    type, // Original type from request
    description: inAppDescription,
    lengthyDesc: inAppLengthyDesc,
    memberId: recipientUser._id,
    ...(project && { projectId: project._id }),
  };

  const createdInAppNotification = await ShowNotification.create(notificationData);

  if (!createdInAppNotification) {
    throw new ApiError(500, "Failed to create in-app notification in database.");
  }

  // --- Send Push Notification ---
  const fcmToken = recipientUser.notificationToken || recipientUser.fcmDeviceToken;
  if (fcmToken) {
    const pushTitle = recipientLang === 'english' ? pushTitles.english : pushTitles.portuguese;
    const pushBody = recipientLang === 'english' ? pushBodies.english : pushBodies.portuguese;
    const pushData = {
      type: type, // Original type from request
      notificationId: createdInAppNotification._id.toString(),
      ...(project && { projectId: project._id.toString() }),
      ...(type.toLowerCase().includes("document") && { documentId: "SPECIFIC_DOCUMENT_ID_IF_APPLICABLE"}), // Example if type is document-related
      title: baseTitle, // Original title from request for payload
    };
    sendPushNotificationFirebase([fcmToken], pushTitle, pushBody, pushData)
      .catch(err => console.error(`[CreateNotification] Failed to send push notification to ${recipientUser._id}:`, err.message));
  } else {
    // console.log(`[CreateNotification] No FCM token for user ${recipientUser._id}, skipping push notification.`);
  }

  // --- Send Email Notification ---
  if (recipientUser.email) {
    const emailDetails = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: recipientUser.email,
      subject: emailSubject,
      html: emailHtmlBody,
    };
    SendEmailUtil(emailDetails)
      .catch(err => console.error(`[CreateNotification] Failed to send email to ${recipientUser.email}:`, err.message));
  } else {
    // console.log(`[CreateNotification] No email for user ${recipientUser._id}, skipping email notification.`);
  }

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        createdInAppNotification,
        "Notification created and dispatched successfully"
      )
    );
});


// --- Other controller functions (getNotifications, getNotificationById, etc.) remain unchanged ---
// ... (paste the rest of your showNotificationController.js functions here)
const getNotifications = asyncHandler(async (req, res) => {
  const { memberId, projectId, isRead } = req.query;
  const filter = {};

  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new ApiError(400, "Invalid recipient (memberId) format in query.");
    }

    // ✅ Check NotificationSetting.status
    const setting = await NotificationSetting.findOne({ userId: memberId });
    if (setting && setting.status === false) { // Check if setting exists before accessing status
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
  
  // Optional: Check NotificationSetting.status for the recipient of THIS notification
  // const setting = await NotificationSetting.findOne({
  //   userId: notification.memberId,
  // });
  // if (setting && setting.status === false) {
  //   return res
  //     .status(200)
  //     .json(
  //       new ApiResponse(200, notification, "Notification fetched, but user has notifications disabled generally.")
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

  // Optional: Check NotificationSetting for the user
  // const setting = await NotificationSetting.findOne({
  //   userId: existingNotification.memberId,
  // });
  // if (setting && setting.status === false) {
  //   // User might still want to mark as read/unread even if general notifications are off
  //   // So, perhaps allow this action regardless of general setting.
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

  // Optional: Check NotificationSetting.status
  // const setting = await NotificationSetting.findOne({ userId: memberId });
  // if (setting && setting.status === false) {
  //    // User might still want to clear even if general notifications are off
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

  const setting = await NotificationSetting.findOne({ userId });
  if (setting && setting.status === false) { // Check if setting exists
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

export {
  createNotification,
  getNotifications,
  getNotificationById,
  updateNotificationStatus,
  clearAllNotifications,
  getAllNotificationsForUser,
};