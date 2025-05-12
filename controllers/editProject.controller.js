import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { editProject } from "../models/project.model.js";
import { User } from "../models/user.model.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";
import { AdditionalMilestone } from "../models/additionalMilestone.js";
import UserDocument from "../models/userdocumentModel.js";
import Document from "../models/documentModel.js";
import FinanceDocument from "../models/finance.model.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

// Helper function to send document notification emails based on language preference
async function sendDocumentNotificationEmail(user, documentInfo) {
  try {
    // Get user's language preference
    const languagePref = await LanguagePreference.findOne({
      userId: user._id,
    }).lean();
    const userLanguage = languagePref?.languageSelected || "portuguese";

    // Email templates
    const templates = {
      portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Notificação de Novo Documento</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: center;"><h2 style="color: #333;">Novo Documento Disponível</h2><p style="font-size: 16px; color: #555;">Olá <strong>${user.userName}</strong>,</p><p style="font-size: 16px; color: #555;">Foi adicionado um novo documento chamado <strong>”${documentInfo.fileName}”</strong> ao projecto <strong>”${documentInfo.projectName}”</strong>.</p><p style="font-size: 16px; color: #555;">Clique no botão abaixo para aceder ao documento:</p><a href="${documentInfo.documentLink}" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">Ver Documento</a><p style="font-size: 14px; color: #999; margin-top: 30px;">Se tiver alguma dúvida ou necessitar de assistência, a nossa equipa está disponível para o apoiar.</p><p style="font-size: 14px; color: #999;">Com os melhores cumprimentos,<br><strong>Equipa Soapro</strong></p></td></tr></table></body></html>`,
      english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Document Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: center;"><h2 style="color: #333;">New Document Available</h2><p style="font-size: 16px; color: #555;">Dear <strong>${user.userName}</strong>,</p><p style="font-size: 16px; color: #555;">A new document titled <strong>"${documentInfo.fileName}"</strong> has been uploaded to the project <strong>"${documentInfo.projectName}"</strong>.</p><p style="font-size: 16px; color: #555;">Click the button below to view the document:</p><a href="${documentInfo.documentLink}" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">View Document</a><p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions or require assistance, our team is available to support you.</p><p style="font-size: 14px; color: #999;">Best regards,<br><strong>Soapro Team</strong></p></td></tr></table></body></html>`,
    };

    await SendEmailUtil({
      from: process.env.EMAIL_FROM || "noreply@example.com",
      to: user.email,
      subject:
        userLanguage === "portuguese"
          ? `Novo Documento: ${documentInfo.fileName}`
          : `New Document: ${documentInfo.fileName}`,
      html: templates[userLanguage],
    });
  } catch (error) {
    console.error(
      `Failed to send document notification email to ${user.email}:`,
      error
    );
  }
}

// Helper function to get language preferences for multiple users
async function getUserLanguagePreferences(userIds) {
  try {
    const languagePreferences = await LanguagePreference.find({
      userId: { $in: userIds },
    }).lean();

    const userLanguageMap = {};
    languagePreferences.forEach((pref) => {
      userLanguageMap[pref.userId.toString()] = pref.languageSelected;
    });

    return userLanguageMap;
  } catch (error) {
    console.error("Error fetching language preferences:", error);
    return {};
  }
}

// Helper function to send project notification emails
async function sendProjectNotificationEmail(
  user,
  projectInfo,
  performingUser,
  changesSummary,
  type
) {
  try {
    // Get user's language preference
    const languagePref = await LanguagePreference.findOne({
      userId: user._id,
    }).lean();
    const userLanguage = languagePref?.languageSelected || "portuguese";

    // Email templates for different notification types
    const templates = {
      update: {
        portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Atualização de Projeto</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Notificação de Atualização de Projeto</h2><p style="font-size: 16px; color: #555;">O projeto <strong>${projectInfo.projectName}</strong> foi atualizado por ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Resumo das alterações:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Por favor, faça login para ver os detalhes completos.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Esta é uma notificação automática.</p></td></tr></table></body></html>`,
        english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Project Update Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Project Update Notification</h2><p style="font-size: 16px; color: #555;">The project <strong>${projectInfo.projectName}</strong> has been updated by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Summary of changes:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`,
      },
      deletion: {
        portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Projeto Eliminado</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Notificação de Eliminação de Projeto</h2><p style="font-size: 16px; color: #555;">O projeto <strong>${projectInfo.projectName}</strong> foi eliminado por ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Todos os documentos e dados associados a este projeto foram removidos do sistema.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Esta é uma notificação automática.</p></td></tr></table></body></html>`,
        english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Project Deleted</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Project Deletion Notification</h2><p style="font-size: 16px; color: #555;">The project <strong>${projectInfo.projectName}</strong> has been deleted by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">All documents and data associated with this project have been removed from the system.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`,
      },
      creation: {
        portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Novo Projeto Criado</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Notificação de Novo Projeto</h2><p style="font-size: 16px; color: #555;">Um novo projeto <strong>${projectInfo.projectName}</strong> foi criado por ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Por favor, faça login para ver os detalhes do projeto.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Esta é uma notificação automática.</p></td></tr></table></body></html>`,
        english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Project Created</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">New Project Notification</h2><p style="font-size: 16px; color: #555;">A new project <strong>${projectInfo.projectName}</strong> has been created by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Please log in to view the project details.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`,
      },
    };

    await SendEmailUtil({
      from: process.env.EMAIL_FROM || "noreply@example.com",
      to: user.email,
      subject:
        userLanguage === "portuguese"
          ? type === "update"
            ? `Atualização de Projeto: ${projectInfo.projectName}`
            : type === "deletion"
              ? `Projeto Eliminado: ${projectInfo.projectName}`
              : `Novo Projeto: ${projectInfo.projectName}`
          : type === "update"
            ? `Project Update: ${projectInfo.projectName}`
            : type === "deletion"
              ? `Project Deleted: ${projectInfo.projectName}`
              : `New Project: ${projectInfo.projectName}`,
      html: templates[type][userLanguage],
    });
  } catch (emailError) {
    console.error(
      `Failed to send project ${type} email to ${user.email}:`,
      emailError.message
    );
  }
}

// Helper function to send push notifications with language support
async function sendLanguageSpecificPushNotifications(users, title, body, data) {
  try {
    // Get language preferences for all users
    const userIds = users.map((user) => user._id.toString());
    const userLanguageMap = await getUserLanguagePreferences(userIds);

    // Group tokens by language
    const tokensByLanguage = {
      portuguese: [],
      english: [],
    };

    users.forEach((user) => {
      const userId = user._id.toString();
      const token = user.fcmDeviceToken || user.notificationToken;
      if (token) {
        const language = userLanguageMap[userId] || "portuguese";
        tokensByLanguage[language].push(token);
      }
    });

    // Send Portuguese notifications
    if (tokensByLanguage.portuguese.length > 0) {
      await sendPushNotification(
        tokensByLanguage.portuguese,
        title.portuguese,
        body.portuguese,
        data
      );
    }

    // Send English notifications
    if (tokensByLanguage.english.length > 0) {
      await sendPushNotification(
        tokensByLanguage.english,
        title.english,
        body.english,
        data
      );
    }
  } catch (error) {
    console.error("Error sending language-specific push notifications:", error);
  }
}

// const editProjects = asyncHandler(async (req, res) => {

//   try {
//     const { projectId } = req.params;
//     const performingUser = req.user;

//     if (!mongoose.Types.ObjectId.isValid(projectId)) {
//       throw new ApiError(400, "Invalid project ID format.");
//     }

//     const {
//       projectName: newProjectNameInput,
//       projectOwners: newProjectOwnerIdsInput,
//       description: newDescriptionInput,
//       location: newLocationInput,
//       businessAreas: newBusinessAreasInput,
//       comapanyName: newCompanyNameInput,
//       members: newMemberIdsInput,
//       status: newStatusInput,
//       deadline: newDeadlineInput,
//       physicalEducationRange: newPhysicalEducationRangeInput,
//       financialEducationRange: newFinancialEducationRangeInput,
//       removeBanners = [],
//     } = req.body;

//     const { files } = req;

//     const existingProject = await editProject
//       .findById(projectId)
//       .populate(
//         "projectOwners.ownerId",
//         "email userName _id notificationToken fcmDeviceToken"
//       )
//       .populate(
//         "members",
//         "email userName _id notificationToken fcmDeviceToken"
//       )
//       .lean();

//     if (!existingProject) {
//       throw new ApiError(404, "Project not found.");
//     }

//     const updateData = {};
//     const logs = [];
//     let updatedProjectBanners = [...(existingProject.projectBanner || [])];
//     const changesSummary = [];
//     let importantFieldsChanged = false;
//     let membersListChanged = false;
//     let ownersListChanged = false;
//     let statusChangedToCompleted = false;

//     let finalProjectName = existingProject.projectName;
//     if (
//       newProjectNameInput &&
//       newProjectNameInput !== existingProject.projectName
//     ) {
//       const nameTaken = await editProject.findOne({
//         projectName: newProjectNameInput,
//         _id: { $ne: projectId },
//       });
//       if (nameTaken) {
//         finalProjectName = `${newProjectNameInput}-${uuidv4().split("-")[0]}`;
//         logs.push({
//           actionType: "Project Name Change (Auto-Adjusted)",
//           message: `Project name "${newProjectNameInput}" was taken, changed to "${finalProjectName}" by ${performingUser.userName}. Original: "${existingProject.projectName}"`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//       } else {
//         finalProjectName = newProjectNameInput;
//         logs.push({
//           actionType: "Project Name Change",
//           message: `Project name changed from "${existingProject.projectName}" to "${finalProjectName}" by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//       }
//       updateData.projectName = finalProjectName;
//       changesSummary.push(`Project name changed to "${finalProjectName}"`);
//       importantFieldsChanged = true;
//     }

//     if (newStatusInput && newStatusInput !== existingProject.status) {
//       updateData.status = newStatusInput;
//       logs.push({
//         actionType: "Status Update",
//         message: `Status changed from "${existingProject.status}" to "${newStatusInput}" by ${performingUser.userName}`,
//         userId: performingUser._id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`Status updated to "${newStatusInput}"`);
//       importantFieldsChanged = true;

//       // Check if status was changed to "Completed"
//       if (newStatusInput === "Completed") {
//         statusChangedToCompleted = true;
//       }
//     }

//     if (newDeadlineInput !== undefined) {
//       if (newDeadlineInput !== existingProject.deadline) {
//         updateData.deadline =
//           newDeadlineInput === "" || newDeadlineInput === null
//             ? null
//             : newDeadlineInput;
//         const oldDeadlineDisplay = existingProject.deadline || "N/A";
//         const newDeadlineDisplay = updateData.deadline || "cleared";
//         logs.push({
//           actionType: "Deadline Change",
//           message: `Deadline updated from "${oldDeadlineDisplay}" to "${newDeadlineDisplay}" by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`Deadline updated to "${newDeadlineDisplay}"`);
//         importantFieldsChanged = true;
//       }
//     }

//     const simpleFieldUpdates = [
//       {
//         key: "description",
//         newValue: newDescriptionInput,
//         name: "Description",
//       },
//       { key: "location", newValue: newLocationInput, name: "Location" },
//       {
//         key: "businessAreas",
//         newValue: newBusinessAreasInput,
//         name: "Business Areas",
//       },
//       {
//         key: "comapanyName",
//         newValue: newCompanyNameInput,
//         name: "Company Name",
//       },
//       {
//         key: "physicalEducationRange",
//         newValue: newPhysicalEducationRangeInput,
//         name: "Physical Education Range",
//       },
//       {
//         key: "financialEducationRange",
//         newValue: newFinancialEducationRangeInput,
//         name: "Financial Education Range",
//       },
//     ];

//     simpleFieldUpdates.forEach(({ key, newValue, name }) => {
//       if (newValue !== undefined && newValue !== existingProject[key]) {
//         updateData[key] = newValue;
//         logs.push({
//           actionType: `${name} Update`,
//           message: `${name} updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`${name} updated`);
//         importantFieldsChanged = true;
//       }
//     });

//     if (Array.isArray(newMemberIdsInput)) {
//       const validatedNewMemberIds = newMemberIdsInput
//         .filter(Boolean)
//         .map((id) => {
//           if (!mongoose.Types.ObjectId.isValid(id))
//             throw new ApiError(400, `Invalid member ID format: ${id}`);
//           return id.toString();
//         });
//       const existingMemberIds = (existingProject.members || []).map((m) =>
//         m._id.toString()
//       );
//       if (
//         JSON.stringify(validatedNewMemberIds.sort()) !==
//         JSON.stringify(existingMemberIds.sort())
//       ) {
//         updateData.members = validatedNewMemberIds.map(
//           (id) => new mongoose.Types.ObjectId(id)
//         );
//         membersListChanged = true;
//         logs.push({
//           actionType: "Members Update",
//           message: `Project members updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push("Project members updated");
//         importantFieldsChanged = true;
//       }
//     }

//     if (Array.isArray(newProjectOwnerIdsInput)) {
//       const validatedNewOwnerIds = newProjectOwnerIdsInput
//         .filter(Boolean)
//         .map((id) => {
//           if (!mongoose.Types.ObjectId.isValid(id))
//             throw new ApiError(400, `Invalid project owner ID format: ${id}`);
//           return id.toString();
//         });
//       const existingOwnerIds = (existingProject.projectOwners || [])
//         .map((o) => o.ownerId?._id.toString())
//         .filter(Boolean);
//       if (
//         JSON.stringify(validatedNewOwnerIds.sort()) !==
//         JSON.stringify(existingOwnerIds.sort())
//       ) {
//         updateData.projectOwners = validatedNewOwnerIds.map((id) => ({
//           ownerId: new mongoose.Types.ObjectId(id),
//         }));
//         ownersListChanged = true;
//         logs.push({
//           actionType: "Owners Update",
//           message: `Project owners updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push("Project owners updated");
//         importantFieldsChanged = true;
//       }
//     }

//     if (Array.isArray(removeBanners) && removeBanners.length > 0) {
//       const initialBannerCount = updatedProjectBanners.length;
//       updatedProjectBanners = updatedProjectBanners.filter(
//         (banner) => !removeBanners.includes(banner.url)
//       );
//       if (updatedProjectBanners.length < initialBannerCount) {
//         updateData.projectBanner = updatedProjectBanners;
//         logs.push({
//           actionType: "Banner Removal",
//           message: `${initialBannerCount - updatedProjectBanners.length} banner(s) removed by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(
//           `${initialBannerCount - updatedProjectBanners.length} banner(s) removed`
//         );
//         importantFieldsChanged = true;
//       }
//     }

//     if (files?.projectBanner?.length > 0) {
//       if (updatedProjectBanners.length + files.projectBanner.length > 10) {
//         throw new ApiError(
//           400,
//           "Cannot upload new banners. Maximum 10 banners allowed in total."
//         );
//       }
//       const uploadPromises = files.projectBanner.map(async (file) => {
//         const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
//         const uploadedImageUrl = await uploadToS3(
//           file.buffer,
//           uniqueFileName,
//           file.mimetype
//         );
//         return uploadedImageUrl
//           ? { url: uploadedImageUrl, uploadDate: new Date() }
//           : null;
//       });
//       const newBanners = (await Promise.all(uploadPromises)).filter(Boolean);
//       if (newBanners.length > 0) {
//         updatedProjectBanners.push(...newBanners);
//         updateData.projectBanner = updatedProjectBanners;
//         logs.push({
//           actionType: "Banner Addition",
//           message: `${newBanners.length} new banner(s) added by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`${newBanners.length} new banner(s) added`);
//         importantFieldsChanged = true;
//       }
//     }

//     if (
//       updateData.projectBanner === undefined &&
//       JSON.stringify(updatedProjectBanners) !==
//         JSON.stringify(existingProject.projectBanner || [])
//     ) {
//       updateData.projectBanner = updatedProjectBanners;
//     }

//     if (Object.keys(updateData).length === 0) {
//       return res
//         .status(200)
//         .json(
//           new ApiResponse(
//             200,
//             existingProject,
//             "No changes detected. Project remains the same."
//           )
//         );
//     }

//     if (logs.length > 0) {
//       updateData.logs = [...(existingProject.logs || []), ...logs];
//     }

//     const session = await mongoose.startSession();
//     session.startTransaction();
//     let updatedProject;

//     try {
//       updatedProject = await editProject
//         .findByIdAndUpdate(
//           projectId,
//           { $set: updateData },
//           { new: true, session, runValidators: true }
//         )
//         .populate(
//           "projectOwners.ownerId",
//           "email userName _id notificationToken fcmDeviceToken"
//         )
//         .populate(
//           "members",
//           "email userName _id notificationToken fcmDeviceToken"
//         );

//       if (!updatedProject) {
//         throw new ApiError(
//           500,
//           "Failed to update project after changes. Project might have been deleted concurrently."
//         );
//       }

//       const inAppNotificationsToCreate = [];
//       if (importantFieldsChanged || membersListChanged || ownersListChanged) {
//         const involvedUserIdsForInApp = new Set();
//         (updatedProject.members || []).forEach(
//           (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
//         );
//         (updatedProject.projectOwners || []).forEach(
//           (o) =>
//             o?.ownerId?._id &&
//             involvedUserIdsForInApp.add(o.ownerId._id.toString())
//         );
//         if (membersListChanged)
//           (existingProject.members || []).forEach(
//             (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
//           );
//         if (ownersListChanged)
//           (existingProject.projectOwners || []).forEach(
//             (o) =>
//               o?.ownerId?._id &&
//               involvedUserIdsForInApp.add(o.ownerId._id.toString())
//           );
//         if (performingUser?._id)
//           involvedUserIdsForInApp.add(performingUser._id.toString());

//         if (changesSummary.length > 0 && involvedUserIdsForInApp.size > 0) {
//           const inAppNotificationMessage = `Project "${updatedProject.projectName}" was updated by ${performingUser.userName}: ${changesSummary.join("; ")}.`;
//           Array.from(involvedUserIdsForInApp).forEach((userIdStr) => {
//             inAppNotificationsToCreate.push({
//               title: `Project Update: ${updatedProject.projectName}`,
//               type: "Project Update",
//               description: inAppNotificationMessage,
//               lengthyDesc: `Details of project update for "${updatedProject.projectName}": ${changesSummary.join("; ")}. Performed by ${performingUser.userName}.`,
//               memberId: new mongoose.Types.ObjectId(userIdStr),
//               projectId: updatedProject._id,
//             });
//           });
//         }
//       }

//       if (inAppNotificationsToCreate.length > 0) {
//         // Get language preferences for all users in one query
//         const userIds = inAppNotificationsToCreate.map((notif) =>
//           notif.memberId.toString()
//         );
//         const languagePreferences = await LanguagePreference.find({
//           userId: { $in: userIds },
//         }).lean();

//         // Create a map of userId to language preference
//         const userLanguageMap = {};
//         languagePreferences.forEach((pref) => {
//           userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//         });

//         // Update notifications based on language preference
//         const notificationsWithLanguage = inAppNotificationsToCreate.map(
//           (notif) => {
//             const userId = notif.memberId.toString();
//             const userLanguage = userLanguageMap[userId] || "portuguese";

//             if (userLanguage === "portuguese") {
//               return {
//                 ...notif,
//                 title: `Atualização de Projeto: ${updatedProject.projectName}`,
//                 description: `O projeto "${updatedProject.projectName}" foi atualizado por ${performingUser.userName}: ${changesSummary.join("; ")}.`,
//                 lengthyDesc: `Detalhes da atualização do projeto "${updatedProject.projectName}": ${changesSummary.join("; ")}. Realizado por ${performingUser.userName}.`,
//               };
//             }
//             return notif;
//           }
//         );

//         await ShowNotification.create(notificationsWithLanguage, {
//           session,
//           ordered: true,
//         });
//       }

//       // Additional notification for completed status
//       if (statusChangedToCompleted) {
//         const involvedUserIdsForReview = new Set();
//         (updatedProject.members || []).forEach(
//           (m) => m?._id && involvedUserIdsForReview.add(m._id.toString())
//         );
//         (updatedProject.projectOwners || []).forEach(
//           (o) =>
//             o?.ownerId?._id &&
//             involvedUserIdsForReview.add(o.ownerId._id.toString())
//         );

//         if (involvedUserIdsForReview.size > 0) {
//           const reviewNotificationsToCreate = [];

//           // Get language preferences for all users in one query
//           const userIds = Array.from(involvedUserIdsForReview);
//           const languagePreferences = await LanguagePreference.find({
//             userId: { $in: userIds },
//           }).lean();

//           // Create a map of userId to language preference
//           const userLanguageMap = {};
//           languagePreferences.forEach((pref) => {
//             userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//           });

//           Array.from(involvedUserIdsForReview).forEach((userIdStr) => {
//             const userLanguage = userLanguageMap[userIdStr] || "portuguese";

//             reviewNotificationsToCreate.push({
//               title:
//                 userLanguage === "portuguese"
//                   ? `Projeto Concluído: ${updatedProject.projectName}`
//                   : `Project Completed: ${updatedProject.projectName}`,
//               type: "Review Request",
//               description:
//                 userLanguage === "portuguese"
//                   ? `O projeto "${updatedProject.projectName}" foi concluído. Por favor, avalie o projeto.`
//                   : `The project "${updatedProject.projectName}" has been completed. Please review the project.`,
//               lengthyDesc:
//                 userLanguage === "portuguese"
//                   ? `O projeto "${updatedProject.projectName}" foi marcado como concluído. Por favor, reserve um momento para escrever uma avaliação sobre sua experiência com este projeto.`
//                   : `The project "${updatedProject.projectName}" has been marked as completed. Please take a moment to write a review about your experience with this project.`,
//               memberId: new mongoose.Types.ObjectId(userIdStr),
//               projectId: updatedProject._id,
//             });
//           });

//           await ShowNotification.create(reviewNotificationsToCreate, {
//             session,
//             ordered: true,
//           });

//           // Send push notifications for review request
//           const usersToNotifyForReview = await User.find({
//             _id: { $in: userIds },
//             $or: [
//               { fcmDeviceToken: { $exists: true } },
//               { notificationToken: { $exists: true } },
//             ],
//           }).lean();

//           // Group by language
//           const reviewTokensByLanguage = {
//             portuguese: [],
//             english: [],
//           };

//           usersToNotifyForReview.forEach((user) => {
//             const token = user.fcmDeviceToken || user.notificationToken;
//             if (token) {
//               const language =
//                 userLanguageMap[user._id.toString()] || "portuguese";
//               reviewTokensByLanguage[language].push(token);
//             }
//           });

//           // Send Portuguese review notifications
//           if (reviewTokensByLanguage.portuguese.length > 0) {
//             try {
//               await sendPushNotification(
//                 reviewTokensByLanguage.portuguese,
//                 `Por favor, avalie o projeto ${updatedProject.projectName}`,
//                 `O projeto foi concluído. Sua avaliação é importante para nós!`,
//                 {
//                   projectId: updatedProject._id.toString(),
//                   type: "REVIEW_REQUEST",
//                 }
//               );
//             } catch (pushError) {
//               console.error(
//                 `Failed to send Portuguese review push notifications for project ${updatedProject._id}:`,
//                 pushError.message
//               );
//             }
//           }

//           // Send English review notifications
//           if (reviewTokensByLanguage.english.length > 0) {
//             try {
//               await sendPushNotification(
//                 reviewTokensByLanguage.english,
//                 `Please review project ${updatedProject.projectName}`,
//                 `The project has been completed. Your feedback is important to us!`,
//                 {
//                   projectId: updatedProject._id.toString(),
//                   type: "REVIEW_REQUEST",
//                 }
//               );
//             } catch (pushError) {
//               console.error(
//                 `Failed to send English review push notifications for project ${updatedProject._id}:`,
//                 pushError.message
//               );
//             }
//           }
//         }
//       }

//       await session.commitTransaction();

//       if (
//         (importantFieldsChanged || membersListChanged || ownersListChanged) &&
//         changesSummary.length > 0
//       ) {
//         const notificationRecipients = new Map();
//         (updatedProject.members || []).forEach(
//           (user) =>
//             user?._id && notificationRecipients.set(user._id.toString(), user)
//         );
//         (updatedProject.projectOwners || []).forEach(
//           (ownerObj) =>
//             ownerObj?.ownerId?._id &&
//             notificationRecipients.set(
//               ownerObj.ownerId._id.toString(),
//               ownerObj.ownerId
//             )
//         );
//         if (membersListChanged)
//           (existingProject.members || []).forEach(
//             (user) =>
//               user?._id &&
//               !notificationRecipients.has(user._id.toString()) &&
//               notificationRecipients.set(user._id.toString(), user)
//           );
//         if (ownersListChanged)
//           (existingProject.projectOwners || []).forEach(
//             (ownerObj) =>
//               ownerObj?.ownerId?._id &&
//               !notificationRecipients.has(ownerObj.ownerId._id.toString()) &&
//               notificationRecipients.set(
//                 ownerObj.ownerId._id.toString(),
//                 ownerObj.ownerId
//               )
//           );

//         if (
//           performingUser?._id &&
//           !notificationRecipients.has(performingUser._id.toString())
//         ) {
//           const performerDetails = await User.findById(performingUser._id)
//             .select("email userName notificationToken fcmDeviceToken")
//             .lean();
//           if (performerDetails)
//             notificationRecipients.set(
//               performerDetails._id.toString(),
//               performerDetails
//             );
//         }

//         const usersToNotify = Array.from(notificationRecipients.values());
//         const fcmTokens = usersToNotify
//           .map((u) => u.fcmDeviceToken || u.notificationToken)
//           .filter(Boolean);

//         if (fcmTokens.length > 0) {
//           // Get language preferences for all users in one query
//           const userIds = usersToNotify.map((user) => user._id.toString());
//           const languagePreferences = await LanguagePreference.find({
//             userId: { $in: userIds },
//           }).lean();

//           // Create a map of userId to language preference
//           const userLanguageMap = {};
//           languagePreferences.forEach((pref) => {
//             userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//           });

//           // Group tokens by language for more efficient sending
//           const tokensByLanguage = {
//             portuguese: [],
//             english: [],
//           };

//           usersToNotify.forEach((user) => {
//             const userId = user._id.toString();
//             const token = user.fcmDeviceToken || user.notificationToken;
//             if (token) {
//               const language = userLanguageMap[userId] || "portuguese";
//               tokensByLanguage[language].push(token);
//             }
//           });

//           // Send Portuguese notifications
//           if (tokensByLanguage.portuguese.length > 0) {
//             const pushTitle = `Atualização de Projeto: ${updatedProject.projectName}`;
//             const pushBody = `${changesSummary.join("; ")}. Por ${performingUser.userName}.`;
//             try {
//               await sendPushNotification(
//                 tokensByLanguage.portuguese,
//                 pushTitle,
//                 pushBody,
//                 {
//                   projectId: updatedProject._id.toString(),
//                   type: "PROJECT_UPDATE",
//                 }
//               );
//             } catch (pushError) {
//               console.error(
//                 `Failed to send Portuguese push notifications for project ${updatedProject._id}:`,
//                 pushError.message
//               );
//             }
//           }

//           // Send English notifications
//           if (tokensByLanguage.english.length > 0) {
//             const pushTitle = `Project Update: ${updatedProject.projectName}`;
//             const pushBody = `${changesSummary.join("; ")}. By ${performingUser.userName}.`;
//             try {
//               await sendPushNotification(
//                 tokensByLanguage.english,
//                 pushTitle,
//                 pushBody,
//                 {
//                   projectId: updatedProject._id.toString(),
//                   type: "PROJECT_UPDATE",
//                 }
//               );
//             } catch (pushError) {
//               console.error(
//                 `Failed to send English push notifications for project ${updatedProject._id}:`,
//                 pushError.message
//               );
//             }
//           }
//         }

//         if (usersToNotify.some((u) => u.email)) {
//           // Get language preferences for all users in one query
//           const userIds = usersToNotify.map((user) => user._id.toString());
//           const languagePreferences = await LanguagePreference.find({
//             userId: { $in: userIds },
//           }).lean();

//           // Create a map of userId to language preference
//           const userLanguageMap = {};
//           languagePreferences.forEach((pref) => {
//             userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//           });

//           // Email templates
//           const emailTemplates = {
//             portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Atualização de Projeto</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Notificação de Atualização de Projeto</h2><p style="font-size: 16px; color: #555;">O projeto <strong>${updatedProject.projectName}</strong> foi atualizado por ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Resumo das alterações:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Por favor, faça login para ver os detalhes completos.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Esta é uma notificação automática.</p></td></tr></table></body></html>`,
//             english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Project Update Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Project Update Notification</h2><p style="font-size: 16px; color: #555;">The project <strong>${updatedProject.projectName}</strong> has been updated by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Summary of changes:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`,
//           };

//           for (const user of usersToNotify) {
//             if (user.email) {
//               try {
//                 const userLanguage =
//                   userLanguageMap[user._id.toString()] || "portuguese";
//                 const emailHtml = emailTemplates[userLanguage];

//                 await SendEmailUtil({
//                   from: process.env.EMAIL_FROM || "noreply@example.com",
//                   to: user.email,
//                   subject:
//                     userLanguage === "portuguese"
//                       ? `Atualização de Projeto: ${updatedProject.projectName}`
//                       : `Project Update: ${updatedProject.projectName}`,
//                   html: emailHtml,
//                 });
//               } catch (emailError) {
//                 console.error(
//                   `Failed to send project update email to ${user.email} for project ${updatedProject._id}:`,
//                   emailError.message
//                 );
//               }
//             }
//           }
//         }
//       }
//       res
//         .status(200)
//         .json(
//           new ApiResponse(200, updatedProject, "Project updated successfully.")
//         );
//     } catch (errorInTransaction) {
//       await session.abortTransaction();
//       console.error(
//         "Error during project update transaction (FULL ERROR OBJECT):",
//         errorInTransaction
//       );
//       if (errorInTransaction instanceof ApiError) throw errorInTransaction;
//       throw new ApiError(
//         500,
//         "An error occurred while saving project changes.",
//         errorInTransaction.errors || [],
//         errorInTransaction.stack
//       );
//     } finally {
//       session.endSession();
//     }
//   } catch (error) {
//     console.error(
//       "Error in editProjects controller (FULL ERROR OBJECT):",
//       error
//     );
//     const statusCode = error instanceof ApiError ? error.statusCode : 500;
//     const message =
//       error instanceof ApiError
//         ? error.message
//         : "An internal server error occurred during project update.";
//     const errors =
//       error instanceof ApiError
//         ? error.errors
//         : error.errors
//           ? error.errors
//           : [];
//     res
//       .status(statusCode)
//       .json(new ApiResponse(statusCode, null, message, errors));
//   }
// });


const editProjects = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const performingUser = req.user; // Assumes req.user is populated by middleware

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid project ID format.");
  }

  const {
    projectName: newProjectNameInput,
    projectOwners: newProjectOwnerIdsInput,
    description: newDescriptionInput,
    location: newLocationInput,
    businessAreas: newBusinessAreasInput,
    comapanyName: newCompanyNameInput, 
    members: newMemberIdsInput,
    status: newStatusInput,
    deadline: newDeadlineInput,
    physicalEducationRange: newPhysicalEducationRangeInput,
    financialEducationRange: newFinancialEducationRangeInput,
    removeBanners = [],
  } = req.body;
  const { files } = req;

  const existingProject = await editProject
    .findById(projectId)
    .populate(
      "projectOwners.ownerId",
      "email userName _id notificationToken fcmDeviceToken"
    )
    .populate(
      "members",
      "email userName _id notificationToken fcmDeviceToken"
    )
    .lean();  

  if (!existingProject) {
    throw new ApiError(404, "Project not found.");
  }

  const updateData = {};
  const logs = [];
  let updatedProjectBanners = [...(existingProject.projectBanner || [])];
  const changesSummary = [];
  let importantFieldsChanged = false;
  let membersListChanged = false;
  let ownersListChanged = false;
  let statusChangedToCompleted = false;

  const trackChange = (fieldKey, newValue, originalValue, fieldName, actionType, messageFormatter) => {
    if (newValue !== undefined && newValue !== originalValue) {
        updateData[fieldKey] = newValue;
        const message = messageFormatter(newValue, originalValue);
        logs.push({
            actionType: actionType,
            message: `${message} by ${performingUser.userName}`,
            userId: performingUser._id,
            timestamp: new Date(),
        });
        changesSummary.push(message);
        importantFieldsChanged = true; 
        return true; 
    }
    return false; 
  };


  if (newProjectNameInput && newProjectNameInput !== existingProject.projectName) {
    const nameTaken = await editProject.findOne(
      {
        projectName: newProjectNameInput,
        _id: { $ne: projectId },
      },
      { _id: 1 } 
    ).lean();

    let finalProjectName;
    let logActionType;
    let logMessage;

    if (nameTaken) {
      finalProjectName = `${newProjectNameInput}-${uuidv4().split("-")[0]}`;
      logActionType = "Project Name Change (Auto-Adjusted)";
      logMessage = `Project name "${newProjectNameInput}" was taken, changed to "${finalProjectName}". Original: "${existingProject.projectName}"`;
    } else {
      finalProjectName = newProjectNameInput;
      logActionType = "Project Name Change";
      logMessage = `Project name changed from "${existingProject.projectName}" to "${finalProjectName}"`;
    }
    updateData.projectName = finalProjectName;
    logs.push({
      actionType: logActionType,
      message: `${logMessage} by ${performingUser.userName}`,
      userId: performingUser._id,
      timestamp: new Date(),
    });
    changesSummary.push(`Project name changed to "${finalProjectName}"`);
    importantFieldsChanged = true;
  }

  if (trackChange(
      "status",
      newStatusInput,
      existingProject.status,
      "Status",
      "Status Update",
      (nv, ov) => `Status changed from "${ov}" to "${nv}"`
  )) {
      if (newStatusInput === "Completed") {
          statusChangedToCompleted = true;
      }
  }

  if (newDeadlineInput !== undefined) {
      const newDeadlineValue = (newDeadlineInput === "" || newDeadlineInput === null) ? null : newDeadlineInput;
      if (newDeadlineValue !== existingProject.deadline) {
           trackChange(
               "deadline",
               newDeadlineValue,
               existingProject.deadline,
               "Deadline",
               "Deadline Change",
               (nv, ov) => `Deadline updated from "${ov || "N/A"}" to "${nv || "cleared"}"`
           );
      }
  }

  trackChange("description", newDescriptionInput, existingProject.description, "Description", "Description Update", () => `Description updated`);
  trackChange("location", newLocationInput, existingProject.location, "Location", "Location Update", () => `Location updated`);
  trackChange("businessAreas", newBusinessAreasInput, existingProject.businessAreas, "Business Areas", "Business Areas Update", () => `Business Areas updated`);
  trackChange("comapanyName", newCompanyNameInput, existingProject.comapanyName, "Company Name", "Company Name Update", () => `Company Name updated`); // Typo: comapanyName
  trackChange("physicalEducationRange", newPhysicalEducationRangeInput, existingProject.physicalEducationRange, "Physical Education Range", "Physical Education Range Update", () => `Physical Education Range updated`);
  trackChange("financialEducationRange", newFinancialEducationRangeInput, existingProject.financialEducationRange, "Financial Education Range", "Financial Education Range Update", () => `Financial Education Range updated`);

  if (Array.isArray(newMemberIdsInput)) {
    const validatedNewMemberIds = newMemberIdsInput
      .filter(Boolean)  
      .map((id) => {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, `Invalid member ID format: ${id}`);
        return id.toString();
      });

    const existingMemberIdSet = new Set((existingProject.members || []).map(m => m._id.toString()));
    const newMemberIdSet = new Set(validatedNewMemberIds);

    if (existingMemberIdSet.size !== newMemberIdSet.size || ![...newMemberIdSet].every(id => existingMemberIdSet.has(id))) {
        updateData.members = validatedNewMemberIds.map(id => new mongoose.Types.ObjectId(id));
        membersListChanged = true;
        logs.push({
            actionType: "Members Update",
            message: `Project members updated by ${performingUser.userName}`,
            userId: performingUser._id,
            timestamp: new Date(),
        });
        changesSummary.push("Project members updated");
        importantFieldsChanged = true; 
    }
  }

  if (Array.isArray(newProjectOwnerIdsInput)) {
    const validatedNewOwnerIds = newProjectOwnerIdsInput
      .filter(Boolean)
      .map((id) => {
        if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(400, `Invalid project owner ID format: ${id}`);
        return id.toString();
      });

    const existingOwnerIdSet = new Set((existingProject.projectOwners || []).map(o => o.ownerId?._id?.toString()).filter(Boolean));
    const newOwnerIdSet = new Set(validatedNewOwnerIds);

    if (existingOwnerIdSet.size !== newOwnerIdSet.size || ![...newOwnerIdSet].every(id => existingOwnerIdSet.has(id))) {
        updateData.projectOwners = validatedNewOwnerIds.map(id => ({ ownerId: new mongoose.Types.ObjectId(id) }));
        ownersListChanged = true;
        logs.push({
            actionType: "Owners Update",
            message: `Project owners updated by ${performingUser.userName}`,
            userId: performingUser._id,
            timestamp: new Date(),
        });
        changesSummary.push("Project owners updated");
        importantFieldsChanged = true; 
    }
  }

  let bannersChanged = false;
  if (Array.isArray(removeBanners) && removeBanners.length > 0) {
    const initialBannerCount = updatedProjectBanners.length;
    updatedProjectBanners = updatedProjectBanners.filter(
      (banner) => banner && banner.url && !removeBanners.includes(banner.url)
    );
    if (updatedProjectBanners.length < initialBannerCount) {
        logs.push({
            actionType: "Banner Removal",
            message: `${initialBannerCount - updatedProjectBanners.length} banner(s) removed by ${performingUser.userName}`,
            userId: performingUser._id,
            timestamp: new Date(),
        });
        changesSummary.push(`${initialBannerCount - updatedProjectBanners.length} banner(s) removed`);
        bannersChanged = true;
        importantFieldsChanged = true;
    }
  }

  const newBannerFiles = files?.projectBanner; 
  if (Array.isArray(newBannerFiles) && newBannerFiles.length > 0) {
      const maxBanners = 10;
      if (updatedProjectBanners.length + newBannerFiles.length > maxBanners) {
          throw new ApiError(400, `Cannot upload ${newBannerFiles.length} new banners. Maximum ${maxBanners} banners allowed in total (current: ${updatedProjectBanners.length}).`);
      }

      const uploadPromises = newBannerFiles.map(async (file) => {
          const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
          try {
              const uploadedImageUrl = await uploadToS3(file.buffer, uniqueFileName, file.mimetype);
              return uploadedImageUrl ? { url: uploadedImageUrl, uploadDate: new Date() } : null;
          } catch (uploadError) {
              console.error(`Failed to upload banner ${file.originalname}:`, uploadError);
              return null; 
          }
      });

      const newBanners = (await Promise.all(uploadPromises)).filter(Boolean);  

      if (newBanners.length > 0) {
          updatedProjectBanners.push(...newBanners);
          logs.push({
              actionType: "Banner Addition",
              message: `${newBanners.length} new banner(s) added by ${performingUser.userName}`,
              userId: performingUser._id,
              timestamp: new Date(),
          });
          changesSummary.push(`${newBanners.length} new banner(s) added`);
          bannersChanged = true;
          importantFieldsChanged = true;
      }
  }

  if (bannersChanged) {
      updateData.projectBanner = updatedProjectBanners;
  }


  if (Object.keys(updateData).length === 0) {
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          existingProject,  
          "No changes detected. Project remains the same."
        )
      );
  }

  if (logs.length > 0) {
    updateData.logs = [...(existingProject.logs || []), ...logs];
  }

  const involvedUserIds = new Set();
  if (performingUser?._id) involvedUserIds.add(performingUser._id.toString());
  (existingProject.members || []).forEach(m => m?._id && involvedUserIds.add(m._id.toString()));
  (existingProject.projectOwners || []).forEach(o => o?.ownerId?._id && involvedUserIds.add(o.ownerId._id.toString()));
  if (membersListChanged) {
    (updateData.members || []).forEach(id => involvedUserIds.add(id.toString()));
  }
  if (ownersListChanged) {
    (updateData.projectOwners || []).forEach(ownerObj => ownerObj?.ownerId && involvedUserIds.add(ownerObj.ownerId.toString()));
  }
  const involvedUserIdArray = Array.from(involvedUserIds);

  let userLanguageMap = {};
  if (involvedUserIdArray.length > 0) {
      try {
          const languagePreferences = await LanguagePreference.find({
              userId: { $in: involvedUserIdArray }
          }).select('userId languageSelected -_id').lean(); 

          languagePreferences.forEach(pref => {
              userLanguageMap[pref.userId.toString()] = pref.languageSelected || 'portuguese'; 
          });
          involvedUserIdArray.forEach(id => {
              if (!userLanguageMap[id]) {
                  userLanguageMap[id] = 'portuguese';
              }
          });
      } catch (langError) {
          console.error("Error fetching language preferences:", langError);
          involvedUserIdArray.forEach(id => { userLanguageMap[id] = 'portuguese'; });
      }
  }


  const session = await mongoose.startSession();
  let transactionSucceeded = false;
  let updatedProject; 

  try {
    session.startTransaction();

    updatedProject = await editProject.findByIdAndUpdate(
        projectId,
        { $set: updateData },
        { new: true, session, runValidators: true }
    )
    .populate("projectOwners.ownerId", "email userName _id notificationToken fcmDeviceToken")
    .populate("members", "email userName _id notificationToken fcmDeviceToken")
    .lean(); 

    if (!updatedProject) {
      throw new ApiError(404, "Project not found during update. It might have been deleted.");
    }

    const notificationsToCreate = [];
    const updateNotificationNeeded = importantFieldsChanged && changesSummary.length > 0;
    const reviewNotificationNeeded = statusChangedToCompleted;

    if ((updateNotificationNeeded || reviewNotificationNeeded) && involvedUserIdArray.length > 0) {
        const changeSummaryString = changesSummary.join("; ");

        involvedUserIdArray.forEach(userIdStr => {
            const userLanguage = userLanguageMap[userIdStr] || 'portuguese';  

            if (updateNotificationNeeded) {
                const isPortuguese = userLanguage === 'portuguese';
                notificationsToCreate.push({
                    title: isPortuguese
                        ? `Atualização de Projeto: ${updatedProject.projectName}`
                        : `Project Update: ${updatedProject.projectName}`,
                    type: "Project Update",
                    description: isPortuguese
                        ? `O projeto "${updatedProject.projectName}" foi atualizado por ${performingUser.userName}: ${changeSummaryString}.`
                        : `Project "${updatedProject.projectName}" was updated by ${performingUser.userName}: ${changeSummaryString}.`,
                    lengthyDesc: isPortuguese
                        ? `Detalhes da atualização do projeto "${updatedProject.projectName}": ${changeSummaryString}. Realizado por ${performingUser.userName}.`
                        : `Details of project update for "${updatedProject.projectName}": ${changeSummaryString}. Performed by ${performingUser.userName}.`,
                    memberId: new mongoose.Types.ObjectId(userIdStr),
                    projectId: updatedProject._id,
                });
            }

            if (reviewNotificationNeeded) {
                const isPortuguese = userLanguage === 'portuguese';
                notificationsToCreate.push({
                    title: isPortuguese
                        ? `Projeto Concluído: ${updatedProject.projectName}`
                        : `Project Completed: ${updatedProject.projectName}`,
                    type: "Review Request",
                    description: isPortuguese
                        ? `O projeto "${updatedProject.projectName}" foi concluído. Por favor, avalie o projeto.`
                        : `The project "${updatedProject.projectName}" has been completed. Please review the project.`,
                    lengthyDesc: isPortuguese
                        ? `O projeto "${updatedProject.projectName}" foi marcado como concluído. Por favor, reserve um momento para escrever uma avaliação sobre sua experiência com este projeto.`
                        : `The project "${updatedProject.projectName}" has been marked as completed. Please take a moment to write a review about your experience with this project.`,
                    memberId: new mongoose.Types.ObjectId(userIdStr),
                    projectId: updatedProject._id,
                });
            }
        });
    }

    if (notificationsToCreate.length > 0) {
      try {
        await ShowNotification.insertMany(notificationsToCreate, { session, ordered: false }); // Use insertMany for bulk creation, ordered: false might be slightly faster if order doesn't matter
      } catch (notificationError) {
        console.error("Error creating in-app notifications within transaction (will proceed):", notificationError);
      }
    }

    await session.commitTransaction();
    transactionSucceeded = true;

  } catch (errorInTransaction) {
    console.error("Error during project update transaction:", errorInTransaction);
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    throw errorInTransaction;

  } finally {
    await session.endSession();
  }

  if (transactionSucceeded && updatedProject) {
    const updateNotificationNeeded = importantFieldsChanged && changesSummary.length > 0;
    const reviewNotificationNeeded = statusChangedToCompleted;

    if ((updateNotificationNeeded || reviewNotificationNeeded) && involvedUserIdArray.length > 0) {
      let usersForNotification = [];
      try {
          usersForNotification = await User.find({ _id: { $in: involvedUserIdArray } })
              .select('email userName notificationToken fcmDeviceToken _id') // Select necessary fields
              .lean();
      } catch (userFetchError) {
          console.error("Error fetching user details for post-transaction notifications:", userFetchError);
          usersForNotification = [];
      }

      if (usersForNotification.length > 0) {
        const changeSummaryString = changesSummary.join("; ");

        const notificationsByLanguage = {
            portuguese: { pushTokens: [], emails: [], pushUpdatePayload: null, pushReviewPayload: null, emailUpdatePayload: null },
            english: { pushTokens: [], emails: [], pushUpdatePayload: null, pushReviewPayload: null, emailUpdatePayload: null }
        };

        usersForNotification.forEach(user => {
            const userIdStr = user._id.toString();
            const lang = userLanguageMap[userIdStr] || 'portuguese';
            const langGroup = notificationsByLanguage[lang];
            const token = user.fcmDeviceToken || user.notificationToken;

            if (token) langGroup.pushTokens.push(token);
            if (user.email) langGroup.emails.push(user.email);

            if (updateNotificationNeeded && !langGroup.pushUpdatePayload) {
                const isPortuguese = lang === 'portuguese';
                langGroup.pushUpdatePayload = {
                    title: isPortuguese ? `Atualização de Projeto: ${updatedProject.projectName}` : `Project Update: ${updatedProject.projectName}`,
                    body: isPortuguese ? `${changeSummaryString}. Por ${performingUser.userName}.` : `${changeSummaryString}. By ${performingUser.userName}.`,
                    data: { projectId: updatedProject._id.toString(), type: "PROJECT_UPDATE" }
                };
                 langGroup.emailUpdatePayload = {
                     subject: isPortuguese ? `Atualização de Projeto: ${updatedProject.projectName}` : `Project Update: ${updatedProject.projectName}`,
                     html: isPortuguese
                         ? `<!DOCTYPE html>... [Portuguese HTML Template for Update] ...</html>` // Replace with actual HTML
                         : `<!DOCTYPE html>... [English HTML Template for Update] ...</html>`   // Replace with actual HTML
                 };
            }
            if (reviewNotificationNeeded && !langGroup.pushReviewPayload) {
                const isPortuguese = lang === 'portuguese';
                 langGroup.pushReviewPayload = {
                    title: isPortuguese ? `Por favor, avalie o projeto ${updatedProject.projectName}` : `Please review project ${updatedProject.projectName}`,
                    body: isPortuguese ? `O projeto foi concluído. Sua avaliação é importante para nós!` : `The project has been completed. Your feedback is important to us!`,
                    data: { projectId: updatedProject._id.toString(), type: "REVIEW_REQUEST" }
                 };
            }
        });


        for (const lang in notificationsByLanguage) {
            const group = notificationsByLanguage[lang];

            if (group.pushUpdatePayload && group.pushTokens.length > 0) {
                sendPushNotification(group.pushTokens, group.pushUpdatePayload.title, group.pushUpdatePayload.body, group.pushUpdatePayload.data)
                    .catch(err => console.error(`Failed to send ${lang} update push notifications for project ${updatedProject._id}:`, err.message)); // Log error, don't throw
            }
            if (group.pushReviewPayload && group.pushTokens.length > 0) {
                 sendPushNotification(group.pushTokens, group.pushReviewPayload.title, group.pushReviewPayload.body, group.pushReviewPayload.data)
                     .catch(err => console.error(`Failed to send ${lang} review push notifications for project ${updatedProject._id}:`, err.message)); // Log error, don't throw
            }
            if (group.emailUpdatePayload && group.emails.length > 0) {
                 group.emails.forEach(email => {
                     SendEmailUtil({
                         from: process.env.EMAIL_FROM || "noreply@example.com",
                         to: email,
                         subject: group.emailUpdatePayload.subject,
                         html: group.emailUpdatePayload.html,
                     }).catch(err => console.error(`Failed to send ${lang} update email to ${email} for project ${updatedProject._id}:`, err.message)); // Log error, don't throw
                 });
            }
             
        }
      }
    }
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        updatedProject,
        "Project updated successfully."
      )
    );

}); 



// const editProjects = asyncHandler(async (req, res) => {
//   const session = await mongoose.startSession();
//   let transactionSucceeded = false;

//   try {
//     const { projectId } = req.params;
//     const performingUser = req.user;

//     if (!mongoose.Types.ObjectId.isValid(projectId)) {
//       throw new ApiError(400, "Invalid project ID format.");
//     }

//     const {
//       projectName: newProjectNameInput,
//       projectOwners: newProjectOwnerIdsInput,
//       description: newDescriptionInput,
//       location: newLocationInput,
//       businessAreas: newBusinessAreasInput,
//       comapanyName: newCompanyNameInput,
//       members: newMemberIdsInput,
//       status: newStatusInput,
//       deadline: newDeadlineInput,
//       physicalEducationRange: newPhysicalEducationRangeInput,
//       financialEducationRange: newFinancialEducationRangeInput,
//       removeBanners = [],
//     } = req.body;

//     const { files } = req;

//     const existingProject = await editProject
//       .findById(projectId)
//       .populate(
//         "projectOwners.ownerId",
//         "email userName _id notificationToken fcmDeviceToken"
//       )
//       .populate(
//         "members",
//         "email userName _id notificationToken fcmDeviceToken"
//       )
//       .lean();

//     if (!existingProject) {
//       throw new ApiError(404, "Project not found.");
//     }

//     const updateData = {};
//     const logs = [];
//     let updatedProjectBanners = [...(existingProject.projectBanner || [])];
//     const changesSummary = [];
//     let importantFieldsChanged = false;
//     let membersListChanged = false;
//     let ownersListChanged = false;
//     let statusChangedToCompleted = false;

//     // Process project name changes
//     let finalProjectName = existingProject.projectName;
//     if (
//       newProjectNameInput &&
//       newProjectNameInput !== existingProject.projectName
//     ) {
//       const nameTaken = await editProject.findOne({
//         projectName: newProjectNameInput,
//         _id: { $ne: projectId },
//       });
//       if (nameTaken) {
//         finalProjectName = `${newProjectNameInput}-${uuidv4().split("-")[0]}`;
//         logs.push({
//           actionType: "Project Name Change (Auto-Adjusted)",
//           message: `Project name "${newProjectNameInput}" was taken, changed to "${finalProjectName}" by ${performingUser.userName}. Original: "${existingProject.projectName}"`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//       } else {
//         finalProjectName = newProjectNameInput;
//         logs.push({
//           actionType: "Project Name Change",
//           message: `Project name changed from "${existingProject.projectName}" to "${finalProjectName}" by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//       }
//       updateData.projectName = finalProjectName;
//       changesSummary.push(`Project name changed to "${finalProjectName}"`);
//       importantFieldsChanged = true;
//     }

//     // Process status changes
//     if (newStatusInput && newStatusInput !== existingProject.status) {
//       updateData.status = newStatusInput;
//       logs.push({
//         actionType: "Status Update",
//         message: `Status changed from "${existingProject.status}" to "${newStatusInput}" by ${performingUser.userName}`,
//         userId: performingUser._id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`Status updated to "${newStatusInput}"`);
//       importantFieldsChanged = true;

//       // Check if status was changed to "Completed"
//       if (newStatusInput === "Completed") {
//         statusChangedToCompleted = true;
//       }
//     }

//     // Process deadline changes
//     if (newDeadlineInput !== undefined) {
//       if (newDeadlineInput !== existingProject.deadline) {
//         updateData.deadline =
//           newDeadlineInput === "" || newDeadlineInput === null
//             ? null
//             : newDeadlineInput;
//         const oldDeadlineDisplay = existingProject.deadline || "N/A";
//         const newDeadlineDisplay = updateData.deadline || "cleared";
//         logs.push({
//           actionType: "Deadline Change",
//           message: `Deadline updated from "${oldDeadlineDisplay}" to "${newDeadlineDisplay}" by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`Deadline updated to "${newDeadlineDisplay}"`);
//         importantFieldsChanged = true;
//       }
//     }

//     // Process other simple field updates
//     const simpleFieldUpdates = [
//       {
//         key: "description",
//         newValue: newDescriptionInput,
//         name: "Description",
//       },
//       { key: "location", newValue: newLocationInput, name: "Location" },
//       {
//         key: "businessAreas",
//         newValue: newBusinessAreasInput,
//         name: "Business Areas",
//       },
//       {
//         key: "comapanyName",
//         newValue: newCompanyNameInput,
//         name: "Company Name",
//       },
//       {
//         key: "physicalEducationRange",
//         newValue: newPhysicalEducationRangeInput,
//         name: "Physical Education Range",
//       },
//       {
//         key: "financialEducationRange",
//         newValue: newFinancialEducationRangeInput,
//         name: "Financial Education Range",
//       },
//     ];

//     simpleFieldUpdates.forEach(({ key, newValue, name }) => {
//       if (newValue !== undefined && newValue !== existingProject[key]) {
//         updateData[key] = newValue;
//         logs.push({
//           actionType: `${name} Update`,
//           message: `${name} updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`${name} updated`);
//         importantFieldsChanged = true;
//       }
//     });

//     // Process members changes
//     if (Array.isArray(newMemberIdsInput)) {
//       const validatedNewMemberIds = newMemberIdsInput
//         .filter(Boolean)
//         .map((id) => {
//           if (!mongoose.Types.ObjectId.isValid(id))
//             throw new ApiError(400, `Invalid member ID format: ${id}`);
//           return id.toString();
//         });
//       const existingMemberIds = (existingProject.members || []).map((m) =>
//         m._id.toString()
//       );
//       if (
//         JSON.stringify(validatedNewMemberIds.sort()) !==
//         JSON.stringify(existingMemberIds.sort())
//       ) {
//         updateData.members = validatedNewMemberIds.map(
//           (id) => new mongoose.Types.ObjectId(id)
//         );
//         membersListChanged = true;
//         logs.push({
//           actionType: "Members Update",
//           message: `Project members updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push("Project members updated");
//         importantFieldsChanged = true;
//       }
//     }

//     // Process project owners changes
//     if (Array.isArray(newProjectOwnerIdsInput)) {
//       const validatedNewOwnerIds = newProjectOwnerIdsInput
//         .filter(Boolean)
//         .map((id) => {
//           if (!mongoose.Types.ObjectId.isValid(id))
//             throw new ApiError(400, `Invalid project owner ID format: ${id}`);
//           return id.toString();
//         });
//       const existingOwnerIds = (existingProject.projectOwners || [])
//         .map((o) => o.ownerId?._id.toString())
//         .filter(Boolean);
//       if (
//         JSON.stringify(validatedNewOwnerIds.sort()) !==
//         JSON.stringify(existingOwnerIds.sort())
//       ) {
//         updateData.projectOwners = validatedNewOwnerIds.map((id) => ({
//           ownerId: new mongoose.Types.ObjectId(id),
//         }));
//         ownersListChanged = true;
//         logs.push({
//           actionType: "Owners Update",
//           message: `Project owners updated by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push("Project owners updated");
//         importantFieldsChanged = true;
//       }
//     }

//     // Process banner removals
//     if (Array.isArray(removeBanners) && removeBanners.length > 0) {
//       const initialBannerCount = updatedProjectBanners.length;
//       updatedProjectBanners = updatedProjectBanners.filter(
//         (banner) => !removeBanners.includes(banner.url)
//       );
//       if (updatedProjectBanners.length < initialBannerCount) {
//         updateData.projectBanner = updatedProjectBanners;
//         logs.push({
//           actionType: "Banner Removal",
//           message: `${initialBannerCount - updatedProjectBanners.length} banner(s) removed by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(
//           `${initialBannerCount - updatedProjectBanners.length} banner(s) removed`
//         );
//         importantFieldsChanged = true;
//       }
//     }

//     // Process banner additions
//     if (files?.projectBanner?.length > 0) {
//       if (updatedProjectBanners.length + files.projectBanner.length > 10) {
//         throw new ApiError(
//           400,
//           "Cannot upload new banners. Maximum 10 banners allowed in total."
//         );
//       }
//       const uploadPromises = files.projectBanner.map(async (file) => {
//         const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
//         const uploadedImageUrl = await uploadToS3(
//           file.buffer,
//           uniqueFileName,
//           file.mimetype
//         );
//         return uploadedImageUrl
//           ? { url: uploadedImageUrl, uploadDate: new Date() }
//           : null;
//       });
//       const newBanners = (await Promise.all(uploadPromises)).filter(Boolean);
//       if (newBanners.length > 0) {
//         updatedProjectBanners.push(...newBanners);
//         updateData.projectBanner = updatedProjectBanners;
//         logs.push({
//           actionType: "Banner Addition",
//           message: `${newBanners.length} new banner(s) added by ${performingUser.userName}`,
//           userId: performingUser._id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`${newBanners.length} new banner(s) added`);
//         importantFieldsChanged = true;
//       }
//     }

//     if (
//       updateData.projectBanner === undefined &&
//       JSON.stringify(updatedProjectBanners) !==
//         JSON.stringify(existingProject.projectBanner || [])
//     ) {
//       updateData.projectBanner = updatedProjectBanners;
//     }

//     // If no changes, return early
//     if (Object.keys(updateData).length === 0) {
//       return res
//         .status(200)
//         .json(
//           new ApiResponse(
//             200,
//             existingProject,
//             "No changes detected. Project remains the same."
//           )
//         );
//     }

//     // Add logs if there are any
//     if (logs.length > 0) {
//       updateData.logs = [...(existingProject.logs || []), ...logs];
//     }

//     // Start transaction
//     session.startTransaction();
//     let updatedProject;

//     try {
//       // Update the project
//       updatedProject = await editProject
//         .findByIdAndUpdate(
//           projectId,
//           { $set: updateData },
//           { new: true, session, runValidators: true }
//         )
//         .populate(
//           "projectOwners.ownerId",
//           "email userName _id notificationToken fcmDeviceToken"
//         )
//         .populate(
//           "members",
//           "email userName _id notificationToken fcmDeviceToken"
//         );

//       if (!updatedProject) {
//         throw new ApiError(
//           500,
//           "Failed to update project after changes. Project might have been deleted concurrently."
//         );
//       }

//       // Create in-app notifications
//       const inAppNotificationsToCreate = [];
//       if (importantFieldsChanged || membersListChanged || ownersListChanged) {
//         const involvedUserIdsForInApp = new Set();
//         (updatedProject.members || []).forEach(
//           (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
//         );
//         (updatedProject.projectOwners || []).forEach(
//           (o) =>
//             o?.ownerId?._id &&
//             involvedUserIdsForInApp.add(o.ownerId._id.toString())
//         );
//         if (membersListChanged)
//           (existingProject.members || []).forEach(
//             (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
//           );
//         if (ownersListChanged)
//           (existingProject.projectOwners || []).forEach(
//             (o) =>
//               o?.ownerId?._id &&
//               involvedUserIdsForInApp.add(o.ownerId._id.toString())
//           );
//         if (performingUser?._id)
//           involvedUserIdsForInApp.add(performingUser._id.toString());

//         if (changesSummary.length > 0 && involvedUserIdsForInApp.size > 0) {
//           const inAppNotificationMessage = `Project "${updatedProject.projectName}" was updated by ${performingUser.userName}: ${changesSummary.join("; ")}.`;
//           Array.from(involvedUserIdsForInApp).forEach((userIdStr) => {
//             inAppNotificationsToCreate.push({
//               title: `Project Update: ${updatedProject.projectName}`,
//               type: "Project Update",
//               description: inAppNotificationMessage,
//               lengthyDesc: `Details of project update for "${updatedProject.projectName}": ${changesSummary.join("; ")}. Performed by ${performingUser.userName}.`,
//               memberId: new mongoose.Types.ObjectId(userIdStr),
//               projectId: updatedProject._id,
//             });
//           });
//         }
//       }

//       // Process in-app notifications with language preferences
//       if (inAppNotificationsToCreate.length > 0) {
//         try {
//           // Get language preferences for all users in one query
//           const userIds = inAppNotificationsToCreate.map((notif) =>
//             notif.memberId.toString()
//           );
//           const languagePreferences = await LanguagePreference.find({
//             userId: { $in: userIds },
//           }).lean();

//           // Create a map of userId to language preference
//           const userLanguageMap = {};
//           languagePreferences.forEach((pref) => {
//             userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//           });

//           // Update notifications based on language preference
//           const notificationsWithLanguage = inAppNotificationsToCreate.map(
//             (notif) => {
//               const userId = notif.memberId.toString();
//               const userLanguage = userLanguageMap[userId] || "portuguese";

//               if (userLanguage === "portuguese") {
//                 return {
//                   ...notif,
//                   title: `Atualização de Projeto: ${updatedProject.projectName}`,
//                   description: `O projeto "${updatedProject.projectName}" foi atualizado por ${performingUser.userName}: ${changesSummary.join("; ")}.`,
//                   lengthyDesc: `Detalhes da atualização do projeto "${updatedProject.projectName}": ${changesSummary.join("; ")}. Realizado por ${performingUser.userName}.`,
//                 };
//               }
//               return notif;
//             }
//           );

//           await ShowNotification.create(notificationsWithLanguage, {
//             session,
//             ordered: true,
//           });
//         } catch (notificationError) {
//           console.error(
//             "Error creating in-app notifications:",
//             notificationError
//           );
//           // Continue with transaction - don't fail the update if notifications fail
//         }
//       }

//       // Additional notification for completed status
//       if (statusChangedToCompleted) {
//         try {
//           const involvedUserIdsForReview = new Set();
//           (updatedProject.members || []).forEach(
//             (m) => m?._id && involvedUserIdsForReview.add(m._id.toString())
//           );
//           (updatedProject.projectOwners || []).forEach(
//             (o) =>
//               o?.ownerId?._id &&
//               involvedUserIdsForReview.add(o.ownerId._id.toString())
//           );

//           if (involvedUserIdsForReview.size > 0) {
//             const reviewNotificationsToCreate = [];

//             // Get language preferences for all users in one query
//             const userIds = Array.from(involvedUserIdsForReview);
//             const languagePreferences = await LanguagePreference.find({
//               userId: { $in: userIds },
//             }).lean();

//             // Create a map of userId to language preference
//             const userLanguageMap = {};
//             languagePreferences.forEach((pref) => {
//               userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//             });

//             Array.from(involvedUserIdsForReview).forEach((userIdStr) => {
//               const userLanguage = userLanguageMap[userIdStr] || "portuguese";

//               reviewNotificationsToCreate.push({
//                 title:
//                   userLanguage === "portuguese"
//                     ? `Projeto Concluído: ${updatedProject.projectName}`
//                     : `Project Completed: ${updatedProject.projectName}`,
//                 type: "Review Request",
//                 description:
//                   userLanguage === "portuguese"
//                     ? `O projeto "${updatedProject.projectName}" foi concluído. Por favor, avalie o projeto.`
//                     : `The project "${updatedProject.projectName}" has been completed. Please review the project.`,
//                 lengthyDesc:
//                   userLanguage === "portuguese"
//                     ? `O projeto "${updatedProject.projectName}" foi marcado como concluído. Por favor, reserve um momento para escrever uma avaliação sobre sua experiência com este projeto.`
//                     : `The project "${updatedProject.projectName}" has been marked as completed. Please take a moment to write a review about your experience with this project.`,
//                 memberId: new mongoose.Types.ObjectId(userIdStr),
//                 projectId: updatedProject._id,
//               });
//             });

//             await ShowNotification.create(reviewNotificationsToCreate, {
//               session,
//               ordered: true,
//             });
//           }
//         } catch (reviewNotificationError) {
//           console.error(
//             "Error creating review notifications:",
//             reviewNotificationError
//           );
//         }
//       }

//       // Commit the transaction
//       await session.commitTransaction();
//       transactionSucceeded = true;

//       // Send push notifications and emails outside the transaction
//       // This way, if they fail, the project update is still saved
//       try {
//         // Send push notifications for project updates
//         if (
//           (importantFieldsChanged || membersListChanged || ownersListChanged) &&
//           changesSummary.length > 0
//         ) {
//           const notificationRecipients = new Map();
//           (updatedProject.members || []).forEach(
//             (user) =>
//               user?._id && notificationRecipients.set(user._id.toString(), user)
//           );
//           (updatedProject.projectOwners || []).forEach(
//             (ownerObj) =>
//               ownerObj?.ownerId?._id &&
//               notificationRecipients.set(
//                 ownerObj.ownerId._id.toString(),
//                 ownerObj.ownerId
//               )
//           );
//           if (membersListChanged)
//             (existingProject.members || []).forEach(
//               (user) =>
//                 user?._id &&
//                 !notificationRecipients.has(user._id.toString()) &&
//                 notificationRecipients.set(user._id.toString(), user)
//             );
//           if (ownersListChanged)
//             (existingProject.projectOwners || []).forEach(
//               (ownerObj) =>
//                 ownerObj?.ownerId?._id &&
//                 !notificationRecipients.has(ownerObj.ownerId._id.toString()) &&
//                 notificationRecipients.set(
//                   ownerObj.ownerId._id.toString(),
//                   ownerObj.ownerId
//                 )
//             );

//           if (
//             performingUser?._id &&
//             !notificationRecipients.has(performingUser._id.toString())
//           ) {
//             const performerDetails = await User.findById(performingUser._id)
//               .select("email userName notificationToken fcmDeviceToken")
//               .lean();
//             if (performerDetails)
//               notificationRecipients.set(
//                 performerDetails._id.toString(),
//                 performerDetails
//               );
//           }

//           const usersToNotify = Array.from(notificationRecipients.values());

//           // Send push notifications
//           try {
//             const fcmTokens = usersToNotify
//               .map((u) => u.fcmDeviceToken || u.notificationToken)
//               .filter(Boolean);

//             if (fcmTokens.length > 0) {
//               // Get language preferences for all users in one query
//               const userIds = usersToNotify.map((user) => user._id.toString());
//               const languagePreferences = await LanguagePreference.find({
//                 userId: { $in: userIds },
//               }).lean();

//               // Create a map of userId to language preference
//               const userLanguageMap = {};
//               languagePreferences.forEach((pref) => {
//                 userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//               });

//               // Group tokens by language for more efficient sending
//               const tokensByLanguage = {
//                 portuguese: [],
//                 english: [],
//               };

//               usersToNotify.forEach((user) => {
//                 const userId = user._id.toString();
//                 const token = user.fcmDeviceToken || user.notificationToken;
//                 if (token) {
//                   const language = userLanguageMap[userId] || "portuguese";
//                   tokensByLanguage[language].push(token);
//                 }
//               });

//               // Send Portuguese notifications
//               if (tokensByLanguage.portuguese.length > 0) {
//                 const pushTitle = `Atualização de Projeto: ${updatedProject.projectName}`;
//                 const pushBody = `${changesSummary.join("; ")}. Por ${performingUser.userName}.`;
//                 try {
//                   await sendPushNotification(
//                     tokensByLanguage.portuguese,
//                     pushTitle,
//                     pushBody,
//                     {
//                       projectId: updatedProject._id.toString(),
//                       type: "PROJECT_UPDATE",
//                     }
//                   );
//                 } catch (pushError) {
//                   console.error(
//                     `Failed to send Portuguese push notifications for project ${updatedProject._id}:`,
//                     pushError.message
//                   );
//                 }
//               }

//               // Send English notifications
//               if (tokensByLanguage.english.length > 0) {
//                 const pushTitle = `Project Update: ${updatedProject.projectName}`;
//                 const pushBody = `${changesSummary.join("; ")}. By ${performingUser.userName}.`;
//                 try {
//                   await sendPushNotification(
//                     tokensByLanguage.english,
//                     pushTitle,
//                     pushBody,
//                     {
//                       projectId: updatedProject._id.toString(),
//                       type: "PROJECT_UPDATE",
//                     }
//                   );
//                 } catch (pushError) {
//                   console.error(
//                     `Failed to send English push notifications for project ${updatedProject._id}:`,
//                     pushError.message
//                   );
//                 }
//               }
//             }
//           } catch (pushError) {
//             console.error("Error sending push notifications:", pushError);
//             // Don't throw - continue with email notifications
//           }

//           // Send email notifications
//           try {
//             if (usersToNotify.some((u) => u.email)) {
//               // Get language preferences for all users in one query
//               const userIds = usersToNotify.map((user) => user._id.toString());
//               const languagePreferences = await LanguagePreference.find({
//                 userId: { $in: userIds },
//               }).lean();

//               // Create a map of userId to language preference
//               const userLanguageMap = {};
//               languagePreferences.forEach((pref) => {
//                 userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//               });

//               // Email templates
//               const emailTemplates = {
//                 portuguese: `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Atualização de Projeto</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Notificação de Atualização de Projeto</h2><p style="font-size: 16px; color: #555;">O projeto <strong>${updatedProject.projectName}</strong> foi atualizado por ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Resumo das alterações:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Por favor, faça login para ver os detalhes completos.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Esta é uma notificação automática.</p></td></tr></table></body></html>`,
//                 english: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Project Update Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Project Update Notification</h2><p style="font-size: 16px; color: #555;">The project <strong>${updatedProject.projectName}</strong> has been updated by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Summary of changes:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`,
//               };

//               for (const user of usersToNotify) {
//                 if (user.email) {
//                   try {
//                     const userLanguage =
//                       userLanguageMap[user._id.toString()] || "portuguese";
//                     const emailHtml = emailTemplates[userLanguage];

//                     await SendEmailUtil({
//                       from: process.env.EMAIL_FROM || "noreply@example.com",
//                       to: user.email,
//                       subject:
//                         userLanguage === "portuguese"
//                           ? `Atualização de Projeto: ${updatedProject.projectName}`
//                           : `Project Update: ${updatedProject.projectName}`,
//                       html: emailHtml,
//                     });
//                   } catch (emailError) {
//                     console.error(
//                       `Failed to send project update email to ${user.email} for project ${updatedProject._id}:`,
//                       emailError.message
//                     );
//                   }
//                 }
//               }
//             }
//           } catch (emailError) {
//             console.error("Error sending email notifications:", emailError);
//             // Don't throw - the project update was successful
//           }
//         }

//         // Send push notifications for review requests
//         if (statusChangedToCompleted) {
//           try {
//             const involvedUserIdsForReview = new Set();
//             (updatedProject.members || []).forEach(
//               (m) => m?._id && involvedUserIdsForReview.add(m._id.toString())
//             );
//             (updatedProject.projectOwners || []).forEach(
//               (o) =>
//                 o?.ownerId?._id &&
//                 involvedUserIdsForReview.add(o.ownerId._id.toString())
//             );

//             if (involvedUserIdsForReview.size > 0) {
//               // Send push notifications for review request
//               const userIds = Array.from(involvedUserIdsForReview);
//               const usersToNotifyForReview = await User.find({
//                 _id: { $in: userIds },
//                 $or: [
//                   { fcmDeviceToken: { $exists: true } },
//                   { notificationToken: { $exists: true } },
//                 ],
//               }).lean();

//               const languagePreferences = await LanguagePreference.find({
//                 userId: { $in: userIds },
//               }).lean();

//               // Create a map of userId to language preference
//               const userLanguageMap = {};
//               languagePreferences.forEach((pref) => {
//                 userLanguageMap[pref.userId.toString()] = pref.languageSelected;
//               });

//               // Group by language
//               const reviewTokensByLanguage = {
//                 portuguese: [],
//                 english: [],
//               };

//               usersToNotifyForReview.forEach((user) => {
//                 const token = user.fcmDeviceToken || user.notificationToken;
//                 if (token) {
//                   const language =
//                     userLanguageMap[user._id.toString()] || "portuguese";
//                   reviewTokensByLanguage[language].push(token);
//                 }
//               });

//               // Send Portuguese review notifications
//               if (reviewTokensByLanguage.portuguese.length > 0) {
//                 try {
//                   await sendPushNotification(
//                     reviewTokensByLanguage.portuguese,
//                     `Por favor, avalie o projeto ${updatedProject.projectName}`,
//                     `O projeto foi concluído. Sua avaliação é importante para nós!`,
//                     {
//                       projectId: updatedProject._id.toString(),
//                       type: "REVIEW_REQUEST",
//                     }
//                   );
//                 } catch (pushError) {
//                   console.error(
//                     `Failed to send Portuguese review push notifications for project ${updatedProject._id}:`,
//                     pushError.message
//                   );
//                 }
//               }

//               // Send English review notifications
//               if (reviewTokensByLanguage.english.length > 0) {
//                 try {
//                   await sendPushNotification(
//                     reviewTokensByLanguage.english,
//                     `Please review project ${updatedProject.projectName}`,
//                     `The project has been completed. Your feedback is important to us!`,
//                     {
//                       projectId: updatedProject._id.toString(),
//                       type: "REVIEW_REQUEST",
//                     }
//                   );
//                 } catch (pushError) {
//                   console.error(
//                     `Failed to send English review push notifications for project ${updatedProject._id}:`,
//                     pushError.message
//                   );
//                 }
//               }
//             }
//           } catch (reviewPushError) {
//             console.error(
//               "Error sending review push notifications:",
//               reviewPushError
//             );
//             // Don't throw - the project update was successful
//           }
//         }
//       } catch (notificationError) {
//         console.error(
//           "Error in post-transaction notifications:",
//           notificationError
//         );
//         // Don't throw - the project update was successful
//       }

//       // Return success response
//       return res
//         .status(200)
//         .json(
//           new ApiResponse(200, updatedProject, "Project updated successfully.")
//         );
//     } catch (errorInTransaction) {
//       // Only abort if the transaction hasn't been committed yet
//       if (!transactionSucceeded) {
//         await session.abortTransaction();
//       }

//       console.error(
//         "Error during project update transaction:",
//         errorInTransaction
//       );

//       throw errorInTransaction; // Re-throw to be caught by the outer try-catch
//     }
//   } catch (error) {
//     // If we haven't ended the session yet and transaction didn't succeed
//     if (session && !transactionSucceeded) {
//       try {
//         await session.abortTransaction();
//       } catch (abortError) {
//         console.error("Error aborting transaction:", abortError);
//       }
//     }

//     console.error("Error in editProjects controller:", error);

//     const statusCode = error instanceof ApiError ? error.statusCode : 500;
//     const message =
//       error instanceof ApiError
//         ? error.message
//         : "An internal server error occurred during project update.";
//     const errors =
//       error instanceof ApiError
//         ? error.errors
//         : error.errors
//           ? error.errors
//           : [];

//     return res
//       .status(statusCode)
//       .json(new ApiResponse(statusCode, null, message, errors));
//   } finally {
//     // Always end the session
//     if (session) {
//       session.endSession();
//     }
//   }
// });

const createProject = asyncHandler(async (req, res) => {
  try {
    const {
      projectName,
      projectOwners,
      description,
      location,
      status,
      businessAreas,
      comapanyName,
      deadline: newDeadlineInput,
      physicalEducationRange,
      financialEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;
    const performingUser = req.user;

    const existingProjectCheck = await editProject.findOne({ projectName });
    if (existingProjectCheck) {
      throw new ApiError(400, "Project name already taken.");
    }

    let validatedDeadline = null;
    if (newDeadlineInput !== undefined) {
      if (newDeadlineInput === "" || newDeadlineInput === null) {
        validatedDeadline = null;
      } else if (typeof newDeadlineInput === "string") {
        validatedDeadline = newDeadlineInput;
      } else {
        throw new ApiError(
          400,
          `Deadline must be a string (e.g., 'DD/MM/YYYY - DD/MM/YYYY'), null, or empty. Received type: ${typeof newDeadlineInput}`
        );
      }
    }

    const validatedProjectOwners = [];
    if (Array.isArray(projectOwners)) {
      projectOwners.forEach((ownerId) => {
        if (
          typeof ownerId === "string" &&
          mongoose.Types.ObjectId.isValid(ownerId)
        ) {
          validatedProjectOwners.push({
            ownerId: new mongoose.Types.ObjectId(ownerId),
          });
        } else if (
          typeof ownerId === "object" &&
          ownerId.ownerId &&
          mongoose.Types.ObjectId.isValid(ownerId.ownerId)
        ) {
          validatedProjectOwners.push({
            ownerId: new mongoose.Types.ObjectId(ownerId.ownerId),
          });
        } else {
          console.warn(
            `Skipping invalid project owner ID format: ${JSON.stringify(ownerId)} during project creation.`
          );
        }
      });
    }

    let projectBanners = [];
    if (files?.projectBanner?.length > 0) {
      if (files.projectBanner.length > 10) {
        throw new ApiError(400, "You can upload up to 10 banners.");
      }
      const uploadFile = async (file) => {
        if (file.size > 5 * 1024 * 1024) {
          console.warn(`File too large, skipped: ${file.originalname}`);
          return null;
        }
        try {
          const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
          const uploadedImageUrl = await uploadToS3(
            file.buffer,
            uniqueFileName,
            file.mimetype
          );
          return uploadedImageUrl
            ? { url: uploadedImageUrl, uploadDate: new Date() }
            : null;
        } catch (uploadError) {
          console.error(
            `Upload failed for ${file.originalname}:`,
            uploadError.message
          );
          return null;
        }
      };
      const batchSize = 3;
      for (let i = 0; i < files.projectBanner.length; i += batchSize) {
        const batch = files.projectBanner.slice(i, i + batchSize);
        const uploadedBatch = await Promise.allSettled(batch.map(uploadFile));
        projectBanners.push(
          ...uploadedBatch
            .filter((result) => result.status === "fulfilled" && result.value)
            .map((result) => result.value)
        );
      }
    }

    const projectData = {
      projectName,
      projectOwners: validatedProjectOwners,
      description,
      businessAreas,
      comapanyName,
      location,
      status: status || "Ongoing",
      deadline: validatedDeadline,
      physicalEducationRange,
      financialEducationRange,
      daysLeft: daysLeft || null,
      projectBanner: projectBanners,
      createdBy: performingUser?._id,
      logs: [
        {
          actionType: "Project Creation",
          message: `Project "${projectName}" created by ${performingUser?.userName || "system"}`,
          userId: performingUser?._id,
          timestamp: new Date(),
        },
      ],
    };

    const project = await editProject.create(projectData);

    if (project && validatedProjectOwners.length > 0) {
      const recipientUserIds = new Set(
        validatedProjectOwners.map((po) => po.ownerId.toString())
      );
      if (performingUser?._id) {
        recipientUserIds.add(performingUser._id.toString());
      }

      if (recipientUserIds.size > 0) {
        try {
          const usersForNotification = await User.find({
            _id: {
              $in: Array.from(recipientUserIds).map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            },
          })
            .select("email userName _id notificationToken fcmDeviceToken")
            .lean();

          // Get language preferences
          const userLanguageMap = await getUserLanguagePreferences(
            Array.from(recipientUserIds)
          );

          // Create in-app notifications with language support
          const inAppNotificationsToCreate = usersForNotification.map(
            (user) => {
              const userLanguage =
                userLanguageMap[user._id.toString()] || "portuguese";
              const isPortuguese = userLanguage === "portuguese";

              return {
                title: isPortuguese
                  ? `Novo Projeto Criado: ${project.projectName}`
                  : `New Project Created: ${project.projectName}`,
                type: "Project Creation",
                description: isPortuguese
                  ? `Um novo projeto "${project.projectName}" foi criado por ${performingUser?.userName || "sistema"}.`
                  : `A new project "${project.projectName}" has been created by ${performingUser?.userName || "system"}.`,
                lengthyDesc: isPortuguese
                  ? `Detalhes do novo projeto "${project.projectName}" criado por ${performingUser?.userName || "sistema"}.`
                  : `Details of new project "${project.projectName}" created by ${performingUser?.userName || "system"}.`,
                memberId: user._id,
                projectId: project._id,
              };
            }
          );

          await ShowNotification.create(inAppNotificationsToCreate);

          // Send push notifications with language support
          const usersWithTokens = usersForNotification.filter(
            (u) => u.fcmDeviceToken || u.notificationToken
          );

          if (usersWithTokens.length > 0) {
            await sendLanguageSpecificPushNotifications(
              usersWithTokens,
              {
                portuguese: `Novo Projeto Criado: ${project.projectName}`,
                english: `New Project Created: ${project.projectName}`,
              },
              {
                portuguese: `Um novo projeto "${project.projectName}" foi criado por ${performingUser?.userName || "sistema"}.`,
                english: `A new project "${project.projectName}" has been created by ${performingUser?.userName || "system"}.`,
              },
              {
                projectId: project._id.toString(),
                type: "PROJECT_CREATED",
              }
            );
          }

          // Send emails with language support
          const usersWithEmails = usersForNotification.filter((u) => u.email);
          for (const user of usersWithEmails) {
            await sendProjectNotificationEmail(
              user,
              { projectName: project.projectName },
              performingUser,
              [],
              "creation"
            );
          }
        } catch (error) {
          console.error(
            "Failed to send project creation notifications:",
            error.message
          );
        }
      }
    }
    res
      .status(201)
      .json(new ApiResponse(201, project, "Project created successfully"));
  } catch (error) {
    console.error("Error in createProject (FULL ERROR OBJECT):", error);
    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : error.name === "ValidationError" || error.name === "CastError"
          ? 400
          : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : "An error occurred during project creation.";
    const errors =
      error instanceof ApiError
        ? error.errors
        : error.errors ||
          (error.name === "ValidationError" ? error.errors : []);
    res
      .status(statusCode)
      .json(new ApiResponse(statusCode, null, message, errors));
  }
});

const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, page, milestoneUserIds, search } = req.query;
    const {
      isMain,
      _id: loggedInUserId,
      assignedBusinessAreas = [],
    } = req.user;
    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];

    let baseFilter = {};
    if (status && validStatuses.includes(status)) {
      baseFilter.status = status;
    }
    if (search) {
      const searchRegex = new RegExp(search, "i");
      baseFilter.$or = [
        { projectName: searchRegex },
        { description: searchRegex },
        { location: searchRegex },
        { comapanyName: searchRegex }, // Assuming this is 'companyName' in your model
      ];
    }

    const userBusinessAreas = assignedBusinessAreas
      .map((area) => area.businessArea)
      .filter(Boolean);
    let finalFilter = { ...baseFilter };

    if (!isMain) {
      const userAccessConditions = [
        { members: loggedInUserId },
        { "projectOwners.ownerId": loggedInUserId },
      ];
      if (userBusinessAreas.length > 0) {
        userAccessConditions.push({
          businessAreas: { $in: userBusinessAreas },
        });
      }
      // Corrected logic for combining baseFilter.$or and userAccessConditions
      if (baseFilter.$or && userAccessConditions.length > 0) {
        finalFilter = {
          $and: [baseFilter, { $or: userAccessConditions }], // if baseFilter.$or exists, it's part of baseFilter
        };
      } else if (baseFilter.$or) {
        // Only baseFilter.$or exists
        finalFilter = baseFilter;
      } else if (userAccessConditions.length > 0) {
        // Only userAccessConditions exist
        finalFilter.$or = userAccessConditions;
      } else {
        // Neither exists, finalFilter remains baseFilter (which might be empty)
        finalFilter = baseFilter;
      }
    }

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const totalProjects = await editProject.countDocuments(finalFilter);
    let query = editProject
      .find(finalFilter)
      .populate([
        {
          path: "members",
          select: "userName avatar role",
          populate: { path: "role", select: "roleName" },
        },
        {
          path: "projectOwners.ownerId",
          select: "userName role",
          populate: { path: "role", select: "roleName" },
        },
      ])
      .sort({ createdAt: -1 });

    if (pageNumber > 0) query = query.skip(skip).limit(pageSize);
    const projects = await query.lean(); // .lean() is important for performance and manual attachment

    let filteredProjectsByMilestone = projects;
    if (milestoneUserIds) {
      try {
        const parsedMilestoneUserIds = JSON.parse(milestoneUserIds);
        if (
          Array.isArray(parsedMilestoneUserIds) &&
          parsedMilestoneUserIds.length > 0
        ) {
          const validUserIdsForMilestoneFilter = parsedMilestoneUserIds.filter(
            (id) => mongoose.Types.ObjectId.isValid(id)
          );
          if (validUserIdsForMilestoneFilter.length > 0) {
            const projectIdsForMilestoneFilter = projects.map(
              (project) => project._id
            ); // Use current page's projects
            const milestonesData = await AdditionalMilestone.find({
              projectId: { $in: projectIdsForMilestoneFilter },
              userId: { $in: validUserIdsForMilestoneFilter },
            })
              .select("projectId")
              .lean();
            const projectsWithMatchingMilestones = new Set(
              milestonesData.map((m) => m.projectId.toString())
            );
            filteredProjectsByMilestone = projects.filter((p) =>
              projectsWithMatchingMilestones.has(p._id.toString())
            );
          }
        }
      } catch (parseError) {
        console.warn(
          "Error parsing milestoneUserIds, skipping milestone filter:",
          parseError.message
        );
      }
    }

    // ---- START: New logic to fetch related documents ----
    const projectIds = filteredProjectsByMilestone.map((p) => p._id);
    const projectNames = filteredProjectsByMilestone
      .map((p) => p.projectName)
      .filter(Boolean); // Filter out any null/undefined names

    let allUserDocs = [],
      allSystemDocs = [],
      allFinanceDocs = [],
      allAdditionalMilestones = [];

    if (projectNames.length > 0) {
      [
        allUserDocs,
        allSystemDocs, // Assuming Document model stores project reports
        allFinanceDocs,
      ] = await Promise.all([
        UserDocument.find({ projName: { $in: projectNames } })
          .sort({ uploadedAt: -1 })
          .lean(),
        Document.find({ projName: { $in: projectNames } })
          .sort({ uploadedAt: -1 })
          .lean(), // System docs
        FinanceDocument.find({ projName: { $in: projectNames } })
          .sort({ uploadedAt: -1 })
          .lean(),
      ]);
    }

    if (projectIds.length > 0) {
      allAdditionalMilestones = await AdditionalMilestone.find({
        projectId: { $in: projectIds },
      })
        .populate({ path: "userId", model: "User", select: "userName" })
        .sort({ createdAt: -1 })
        .lean();
    }

    // Helper to group documents by project identifier
    const groupDocsBy = (docs, keyField) => {
      return docs.reduce((acc, doc) => {
        const key = doc[keyField]?.toString(); // Use .toString() for ObjectIds
        if (key) {
          if (!acc[key]) acc[key] = [];
          acc[key].push(doc);
        }
        return acc;
      }, {});
    };

    const userDocsMap = groupDocsBy(allUserDocs, "projName");
    const systemDocsMap = groupDocsBy(allSystemDocs, "projName");
    const financeDocsMap = groupDocsBy(allFinanceDocs, "projName");
    const additionalMilestonesMap = groupDocsBy(
      allAdditionalMilestones,
      "projectId"
    );
    // ---- END: New logic to fetch related documents ----

    const projectsWithDetails = filteredProjectsByMilestone.map((project) => {
      const isMember =
        project.members?.some((member) => member._id.equals(loggedInUserId)) ||
        false;
      const isOwner =
        project.projectOwners?.some(
          (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
        ) || false;
      const projectBAs = Array.isArray(project.businessAreas)
        ? project.businessAreas
        : project.businessAreas
          ? [project.businessAreas]
          : [];
      const fromBusinessArea =
        !isMember &&
        !isOwner &&
        projectBAs.some((area) => userBusinessAreas.includes(area));

      // Attach the fetched documents
      const projectUserDocs = userDocsMap[project.projectName] || [];
      const projectSystemDocs = systemDocsMap[project.projectName] || [];
      const projectFinanceDocs = financeDocsMap[project.projectName] || [];
      const projectAdditionalMilestones =
        additionalMilestonesMap[project._id.toString()] || [];

      return {
        ...project,
        accessType: { isMember, isOwner, fromBusinessArea },
        // Match structure from getProjectById for consistency
        documents: projectUserDocs.map((doc) => ({
          ...doc,
          id: doc._id,
          uploadedAt: doc.uploadedAt || doc.createdAt,
        })),
        financeDocuments: projectFinanceDocs.map((doc) => ({
          ...doc,
          id: doc._id,
        })),
        projectReports: projectSystemDocs.map((report) => ({
          ...report,
          id: report._id,
          uploadedAt: report.uploadedAt || report.createdAt,
        })),
        additionalMilestones: projectAdditionalMilestones, // Already populated and sorted
      };
    });

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects: projectsWithDetails,
          pagination: {
            currentPage: pageNumber,
            totalPages: Math.ceil(totalProjects / pageSize),
            totalProjects,
          },
        },
        "Projects retrieved successfully"
      )
    );
  } catch (error) {
    console.error("Error in getAllProjects (FULL ERROR OBJECT):", error);
    // Ensure ApiError is properly instantiated and thrown for asyncHandler to catch
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error.statusCode || 500,
      error.message || "Failed to retrieve projects"
    );
  }
});

const getProjectById = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      isMain,
      _id: loggedInUserId,
      assignedBusinessAreas = [],
    } = req.user;

    if (!mongoose.Types.ObjectId.isValid(projectId))
      throw new ApiError(400, "Invalid Project ID format");

    const project = await editProject
      .findById(projectId)
      .populate([
        {
          path: "members",
          model: "User",
          select: "userName avatar role userType",
          populate: { path: "role", model: "Role", select: "roleName" },
        },
        {
          path: "projectOwners.ownerId",
          model: "User",
          select: "userName role email",
          populate: { path: "role", select: "roleName" },
        },
      ])
      .lean();

    if (!project) throw new ApiError(404, "Project not found");

    if (!isMain) {
      const isMember =
        project.members?.some((member) => member._id.equals(loggedInUserId)) ||
        false;
      const isOwner =
        project.projectOwners?.some(
          (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
        ) || false;
      const projectBAs = Array.isArray(project.businessAreas)
        ? project.businessAreas
        : project.businessAreas
          ? [project.businessAreas]
          : [];
      const userBAs = assignedBusinessAreas
        .map((ba) => ba.businessArea)
        .filter(Boolean);
      const businessAreaMatch = projectBAs.some((pba) => userBAs.includes(pba));
      if (!isMember && !isOwner && !businessAreaMatch) {
        throw new ApiError(
          403,
          "You don't have permission to access this project."
        );
      }
    }

    const currentMilestones = [
      { name: "Project Details", completed: true, key: "details" },
      { name: "Filling", completed: false, key: "filling" },
      { name: "Payment", completed: false, key: "payment" },
      { name: "Review", completed: false, key: "review" },
      { name: "Completed", completed: false, key: "project_completed" },
    ];

    const isFillingComplete =
      project.description &&
      project.location &&
      project.projectName &&
      project.projectBanner?.length > 0 &&
      project.members?.length > 0;
    if (isFillingComplete)
      (currentMilestones.find((m) => m.key === "filling") || {}).completed =
        true;

    const [
      projectUserDocs,
      projectSystemDocs,
      projectFinanceDocs,
      projectAdditionalMilestones,
    ] = await Promise.all([
      UserDocument.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      Document.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      FinanceDocument.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      AdditionalMilestone.find({ projectId: project._id })
        .populate({ path: "userId", model: "User", select: "userName" })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (projectFinanceDocs.length > 0)
      (currentMilestones.find((m) => m.key === "payment") || {}).completed =
        true;
    const fillingMilestone = currentMilestones.find(
      (m) => m.key === "filling"
    ) || { completed: false };
    const paymentMilestone = currentMilestones.find(
      (m) => m.key === "payment"
    ) || { completed: false };
    if (fillingMilestone.completed && paymentMilestone.completed) {
      (currentMilestones.find((m) => m.key === "review") || {}).completed =
        true;
    }
    if (project.status === "Completed")
      (
        currentMilestones.find((m) => m.key === "project_completed") || {}
      ).completed = true;

    const responseData = {
      ...project,
      members:
        project.members?.map((member) => ({
          userId: member._id,
          _id: member._id,
          userName: member.userName,
          avatar: member.avatar,
          userType: member.userType || "N/A",
          role: member.role?.roleName || "N/A",
        })) || [],
      projectOwners:
        project.projectOwners
          ?.filter((owner) => owner.ownerId)
          .map((owner) => ({
            ownerId: owner.ownerId._id,
            ownerName: owner.ownerId.userName || "",
            role: owner.ownerId.role?.roleName || "N/A",
            _id: owner.ownerId._id,
            email: owner.ownerId.email || "",
          })) || [],
      documents: projectUserDocs.map((doc) => ({
        ...doc,
        id: doc._id,
        uploadedAt: doc.uploadedAt || doc.createdAt,
      })),
      financeDocuments: projectFinanceDocs.map((doc) => ({
        ...doc,
        id: doc._id,
      })),
      projectReports: projectSystemDocs.map((report) => ({
        ...report,
        id: report._id,
        uploadedAt: report.uploadedAt || report.createdAt,
      })),
      latestLog:
        project.logs?.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        )[0] || null,
      milestones: currentMilestones,
      additionalMilestones: projectAdditionalMilestones,
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseData, "Project retrieved successfully")
      );
  } catch (error) {
    console.error("Error in getProjectById (FULL ERROR OBJECT):", error);
    throw new ApiError(
      error.statusCode || 500,
      error.message || "Failed to retrieve project details"
    );
  }
});

const deleteProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const performingUser = req.user;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID format.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const projectToDelete = await editProject
      .findById(projectId)
      .populate(
        "projectOwners.ownerId",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .populate(
        "members",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .session(session)
      .lean();

    if (!projectToDelete) {
      throw new ApiError(404, "Project not found.");
    }

    const deletedProjectName = projectToDelete.projectName;
    const deletedProjectId = projectToDelete._id;

    await editProject.findByIdAndDelete(projectId, { session });
    await UserDocument.deleteMany(
      { projName: deletedProjectName },
      { session }
    );
    await Document.deleteMany({ projName: deletedProjectName }, { session });
    await FinanceDocument.deleteMany(
      { projName: deletedProjectName },
      { session }
    );
    await AdditionalMilestone.deleteMany(
      { projectId: deletedProjectId },
      { session }
    );

    const notificationRecipients = new Map();
    (projectToDelete.members || []).forEach(
      (user) =>
        user?._id && notificationRecipients.set(user._id.toString(), user)
    );
    (projectToDelete.projectOwners || []).forEach(
      (ownerObj) =>
        ownerObj?.ownerId?._id &&
        notificationRecipients.set(
          ownerObj.ownerId._id.toString(),
          ownerObj.ownerId
        )
    );

    let performerDetailsForNotification = null;
    if (performingUser?._id) {
      if (!notificationRecipients.has(performingUser._id.toString())) {
        performerDetailsForNotification = await User.findById(
          performingUser._id
        )
          .select("email userName _id notificationToken fcmDeviceToken")
          .lean();
        if (performerDetailsForNotification) {
          notificationRecipients.set(
            performerDetailsForNotification._id.toString(),
            performerDetailsForNotification
          );
        }
      } else {
        performerDetailsForNotification = notificationRecipients.get(
          performingUser._id.toString()
        );
      }
    }

    const usersToNotify = Array.from(notificationRecipients.values());

    if (usersToNotify.length > 0) {
      // Get language preferences for all users
      const userIds = usersToNotify.map((user) => user._id.toString());
      const userLanguageMap = await getUserLanguagePreferences(userIds);

      // Create in-app notifications with language support
      const inAppNotificationsToCreate = usersToNotify.map((user) => {
        const userLanguage =
          userLanguageMap[user._id.toString()] || "portuguese";
        const isPortuguese = userLanguage === "portuguese";

        return {
          title: isPortuguese
            ? `Projeto Eliminado: ${deletedProjectName}`
            : `Project Deleted: ${deletedProjectName}`,
          type: "Project Deletion",
          description: isPortuguese
            ? `O projeto "${deletedProjectName}" foi eliminado por ${performingUser.userName}.`
            : `The project "${deletedProjectName}" was deleted by ${performingUser.userName}.`,
          lengthyDesc: isPortuguese
            ? `Todos os documentos e dados associados ao projeto "${deletedProjectName}" foram removidos do sistema. Ação realizada por ${performingUser.userName}.`
            : `All documents and data associated with project "${deletedProjectName}" have been removed from the system. Action performed by ${performingUser.userName}.`,
          memberId: user._id,
          projectId: deletedProjectId,
        };
      });

      await ShowNotification.create(inAppNotificationsToCreate, {
        session,
        ordered: true,
      });
    }

    await session.commitTransaction();

    if (usersToNotify.length > 0) {
      // Send push notifications with language support
      const usersWithTokens = usersToNotify.filter(
        (u) => u.fcmDeviceToken || u.notificationToken
      );

      if (usersWithTokens.length > 0) {
        await sendLanguageSpecificPushNotifications(
          usersWithTokens,
          {
            portuguese: `Projeto Eliminado: ${deletedProjectName}`,
            english: `Project Deleted: ${deletedProjectName}`,
          },
          {
            portuguese: `O projeto "${deletedProjectName}" foi eliminado por ${performingUser.userName}.`,
            english: `The project "${deletedProjectName}" was deleted by ${performingUser.userName}.`,
          },
          {
            deletedProjectId: deletedProjectId.toString(),
            type: "PROJECT_DELETED",
          }
        );
      }

      // Send emails with language support
      const usersWithEmails = usersToNotify.filter((u) => u.email);
      for (const user of usersWithEmails) {
        await sendProjectNotificationEmail(
          user,
          { projectName: deletedProjectName },
          performingUser,
          [],
          "deletion"
        );
      }
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { deletedProjectId, projectName: deletedProjectName },
          "Project deleted successfully."
        )
      );
  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting project (FULL ERROR OBJECT):", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : "An error occurred while deleting the project.";
    res
      .status(statusCode)
      .json(new ApiResponse(statusCode, null, message, error.errors || []));
  } finally {
    session.endSession();
  }
});

export {
  createProject,
  editProjects,
  getAllProjects,
  getProjectById,
  deleteProject,
};
