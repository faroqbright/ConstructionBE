import { ShowNotification } from "../models/showNotificationSchema.js";
import { NotificationSetting } from "../models/notificationSetting.model.js";
import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import mongoose from "mongoose";
import { SendEmailUtil } from "../utils/emailsender.js";
import { sendNotification as sendPushNotificationFirebase } from "../utils/firebase.service.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

async function getUserLanguagePreference(userId) {
  if (!userId) return 'portuguese';
  try {
    const objectIdUserId = new mongoose.Types.ObjectId(userId);
    const preference = await LanguagePreference.findOne({ userId: objectIdUserId }).lean();
    return preference?.languageSelected || 'portuguese';
  } catch (error) {
    console.warn(`[getUserLanguagePreference] Error converting or fetching pref for ${userId}:`, error.message);
    return 'portuguese';
  }
}

const createNotification = asyncHandler(async (req, res) => {
  const {
    title: requestTitle,
    type,
    description: requestDescription,
    lengthyDesc: requestLengthyDesc,
    memberId,
    projectId,
  } = req.body;

  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "a system process";

  console.log("[CreateNotification] Start. Req Body:", req.body);
  console.log(`[CreateNotification] Performing User: ${performingUserName} (${performingUserId})`);

  if (!requestTitle || !type || !memberId) {
    throw new ApiError(400, "Title, type, and memberId are required.");
  }
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    throw new ApiError(400, "Invalid recipient (memberId) format.");
  }
  if (projectId && !mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  const recipientUser = await User.findById(memberId)
    .select("_id userName email notificationToken fcmDeviceToken")
    .lean();

  if (!recipientUser) {
    throw new ApiError(404, "Recipient user (memberId) not found.");
  }
  console.log("[CreateNotification] Recipient User Fetched:", { _id: recipientUser._id, userName: recipientUser.userName, email: recipientUser.email, notificationToken: recipientUser.notificationToken, fcmDeviceToken: recipientUser.fcmDeviceToken });


  const setting = await NotificationSetting.findOne({ userId: recipientUser._id });
  if (setting && setting.status === false) {
    console.log(`[CreateNotification] Notifications disabled for user ${recipientUser._id}. Skipping.`);
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

  const recipientLang = await getUserLanguagePreference(recipientUser._id);
  console.log(`[CreateNotification] Recipient Language for ${recipientUser._id}: ${recipientLang}`);

  let project = null;
  let projectNameForMsg = "";
  if (projectId) {
    project = await editProject.findById(projectId).select("projectName").lean();
    if (project) {
      projectNameForMsg = project.projectName;
      console.log(`[CreateNotification] Project Fetched: ${projectNameForMsg}`);
    } else {
      console.warn(`[CreateNotification] Project with ID ${projectId} not found.`);
    }
  }

  const baseTitle = requestTitle;
  const baseDescription = requestDescription || "";
  const baseLengthyDesc = requestLengthyDesc || baseDescription;

  let inAppTitle, inAppDescription, inAppLengthyDesc;
  let pushTitles = { english: "", portuguese: ""}; // Initialize to prevent undefined
  let pushBodies = { english: "", portuguese: ""}; // Initialize
  let emailSubject, emailHtmlBody;

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

    pushTitles.english = project ? `Project ${projectNameForMsg}: ${baseTitle}` : `New Notification: ${baseTitle}`;
    pushBodies.english = project
        ? `${baseDescription.substring(0,100)}... (Project: ${projectNameForMsg}) by ${performingUserName}`
        : `${baseDescription.substring(0,100)}... by ${performingUserName}`;
    
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

    pushTitles.portuguese = project ? `Projecto ${projectNameForMsg}: ${baseTitle}` : `Nova Notificação: ${baseTitle}`;
    pushBodies.portuguese = project
        ? `${baseDescription.substring(0,100)}... (Projecto: ${projectNameForMsg}) por ${performingUserName}`
        : `${baseDescription.substring(0,100)}... por ${performingUserName}`;

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

  const notificationData = {
    title: inAppTitle, type, description: inAppDescription, lengthyDesc: inAppLengthyDesc,
    memberId: recipientUser._id,
    ...(project && { projectId: project._id }),
  };

  const createdInAppNotification = await ShowNotification.create(notificationData);

  if (!createdInAppNotification) {
    throw new ApiError(500, "Failed to create in-app notification in database.");
  }
  console.log("[CreateNotification] In-App Notification Created:", createdInAppNotification._id);

  // --- Send Push Notification ---
  console.log(`[CreateNotification] Attempting to send PUSH notification to user ${recipientUser._id}`);
  const fcmToken = recipientUser.notificationToken || recipientUser.fcmDeviceToken;
  
  console.log(`[CreateNotification] User's notificationToken: '${recipientUser.notificationToken}', fcmDeviceToken: '${recipientUser.fcmDeviceToken}'`);
  console.log(`[CreateNotification] Effective FCM Token for push: '${fcmToken}'`);

  if (fcmToken && typeof fcmToken === 'string' && fcmToken.trim() !== "") {
    const pushTitle = recipientLang === 'english' ? pushTitles.english : pushTitles.portuguese;
    const pushBody = recipientLang === 'english' ? pushBodies.english : pushBodies.portuguese;
    
    // Ensure pushTitle and pushBody are not empty
    if (!pushTitle || pushTitle.trim() === "") {
        console.warn(`[CreateNotification] Push title is empty for lang ${recipientLang}. Using a default title.`);
        // pushTitle = "New Notification"; // Or handle as an error
    }
    if (!pushBody || pushBody.trim() === "") {
        console.warn(`[CreateNotification] Push body is empty for lang ${recipientLang}. Using a default body.`);
        // pushBody = "You have a new notification."; // Or handle
    }


    const pushData = {
      type: type,
      notificationId: createdInAppNotification._id.toString(),
      ...(project && { projectId: project._id.toString() }),
      ...(type.toLowerCase().includes("document") && { documentId: "SPECIFIC_DOCUMENT_ID_IF_APPLICABLE"}),
      title: baseTitle,
    };

    console.log(`[CreateNotification] PUSH Payload for ${recipientUser._id} (lang: ${recipientLang}):`);
    console.log(`  Token: ${fcmToken}`);
    console.log(`  Title: ${pushTitle}`);
    console.log(`  Body: ${pushBody}`);
    console.log(`  Data: ${JSON.stringify(pushData)}`);

    sendPushNotificationFirebase([fcmToken], pushTitle, pushBody, pushData)
      .then(response => {
        // Make sure your firebase.service.js actually returns a meaningful response
        console.log(`[CreateNotification] PUSH notification sent successfully to ${recipientUser._id}. Response:`, JSON.stringify(response));
      })
      .catch(err => {
        console.error(`[CreateNotification] FAILED to send PUSH notification to ${recipientUser._id} (Token: ${fcmToken}). Error:`, err.message);
        console.error("[CreateNotification] Full Push Error Object:", err); // Log the full error
      });
  } else {
    console.log(`[CreateNotification] SKIPPING PUSH for user ${recipientUser._id}: No valid FCM token found.`);
  }

  // --- Send Email Notification ---
  if (recipientUser.email) {
    console.log(`[CreateNotification] Attempting to send EMAIL to ${recipientUser.email}`);
    const emailDetails = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: recipientUser.email,
      subject: emailSubject,
      html: emailHtmlBody,
    };
    SendEmailUtil(emailDetails)
      .then(() => {
        console.log(`[CreateNotification] Email sent successfully to ${recipientUser.email}`);
      })
      .catch(err => 
        console.error(`[CreateNotification] Failed to send EMAIL to ${recipientUser.email}:`, err.message)
      );
  } else {
    console.log(`[CreateNotification] SKIPPING EMAIL for user ${recipientUser._id}: No email address found.`);
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


// --- Other controller functions (getNotifications, getNotificationById, etc.) ---
// (Make sure these are also present in your file)
const getNotifications = asyncHandler(async (req, res) => {
  const { memberId, projectId, isRead } = req.query;
  const filter = {};

  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw new ApiError(400, "Invalid recipient (memberId) format in query.");
    }
    const setting = await NotificationSetting.findOne({ userId: memberId });
    if (setting && setting.status === false) {
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
  if (setting && setting.status === false) { 
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