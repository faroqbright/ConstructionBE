import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js"; // Assuming editProject is your Project model
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { User } from "../models/user.model.js";
import { sendNotification as sendPushNotificationFirebase } from "../utils/firebase.service.js"; // Renamed to avoid conflict
import { LanguagePreference } from "../models/languagePreferenceSchema.js"; // Added for language preferences

// Helper function to get language preferences for multiple users
async function getUserLanguagePreferences(userIds) {
  if (!userIds || userIds.length === 0) {
    return {};
  }
  try {
    const objectIdUserIds = userIds.map(id => {
      try {
        return new mongoose.Types.ObjectId(id);
      } catch (e) {
        // console.warn(`Invalid ObjectId string for language preference: ${id}`);
        return null;
      }
    }).filter(id => id !== null);

    if (objectIdUserIds.length === 0) return {};

    const languagePreferences = await LanguagePreference.find({
      userId: { $in: objectIdUserIds },
    }).lean();

    const userLanguageMap = {};
    languagePreferences.forEach((pref) => {
      userLanguageMap[pref.userId.toString()] = pref.languageSelected;
    });

    // For users not in LanguagePreference, assign a default
    userIds.forEach(userId => {
      if (!userLanguageMap[userId.toString()]) {
        userLanguageMap[userId.toString()] = 'portuguese'; // Default language
      }
    });
    return userLanguageMap;
  } catch (error) {
    console.error("Error fetching language preferences:", error);
    // Fallback: default for all if error occurs
    return userIds.reduce((acc, userId) => {
        acc[userId.toString()] = 'portuguese';
        return acc;
    }, {});
  }
}


// Helper function to get recipients (user objects with tokens) and their IDs
const getDocumentNotificationRecipients = async (
  projectName,
  performingUserId
) => {
  // console.log(
  //   `[Document Notification] Getting recipients for project ${projectName}, performing user: ${performingUserId}`
  // );

  const projectData = await editProject // Renamed to avoid conflict if 'project' is in outer scope
    .findOne({ projectName })
    .populate("members", "_id userName email notificationToken fcmDeviceToken")
    .populate(
      "projectOwners.ownerId",
      "_id userName email notificationToken fcmDeviceToken"
    );

  if (!projectData) {
    // console.warn("[Document Notification] Project not found:", projectName);
    if (performingUserId) {
      const performer = await User.findById(performingUserId)
        .select("_id userName email notificationToken fcmDeviceToken")
        .lean();
      if (performer) {
        const token = performer.notificationToken || performer.fcmDeviceToken;
        return {
          recipients: [{ ...performer, effectiveToken: token }],
          recipientIds: new Set([performer._id.toString()]),
          project: null,
        };
      }
    }
    return { recipients: [], recipientIds: new Set(), project: null };
  }

  const recipientUserObjects = [];
  const recipientUserObjectIds = new Set();

  projectData.members?.forEach((member) => {
    if (member?._id) {
      const token = member.notificationToken || member.fcmDeviceToken;
      recipientUserObjects.push({
        ...member.toObject(),
        effectiveToken: token,
      });
      recipientUserObjectIds.add(member._id.toString());
    }
  });

  projectData.projectOwners?.forEach((ownerObj) => {
    if (ownerObj?.ownerId?._id) {
      const token =
        ownerObj.ownerId.notificationToken || ownerObj.ownerId.fcmDeviceToken;
      recipientUserObjects.push({
        ...ownerObj.ownerId.toObject(),
        effectiveToken: token,
      });
      recipientUserObjectIds.add(ownerObj.ownerId._id.toString());
    }
  });

  if (
    performingUserId &&
    !recipientUserObjectIds.has(performingUserId.toString())
  ) {
    const performer = await User.findById(performingUserId)
      .select("_id userName email notificationToken fcmDeviceToken")
      .lean();
    if (performer) {
      const token = performer.notificationToken || performer.fcmDeviceToken;
      recipientUserObjects.push({
        ...performer,
        effectiveToken: token,
      });
      recipientUserObjectIds.add(performer._id.toString());
    }
  }

  // console.log(
  //   `[Document Notification] Total unique recipients: ${recipientUserObjectIds.size}`
  // );
  return {
    recipients: recipientUserObjects,
    recipientIds: recipientUserObjectIds,
    project: projectData, // Return the populated project object
  };
};

// Helper function to send document push notifications (now language aware)
const sendDocumentPushNotifications = async (
  recipientsWithTokens, // These are user objects with language preference potentially
  titles, // { english: "...", portuguese: "..." }
  bodies, // { english: "...", portuguese: "..." }
  data,
  userLanguageMap // Map of userId to language
) => {
  try {
    if (!recipientsWithTokens || recipientsWithTokens.length === 0) {
      // console.warn("[Document Push] No recipients provided.");
      return;
    }
    // console.log(
    //   `[Document Push] Preparing to send to ${recipientsWithTokens.length} potential users`
    // );

    const tokensByLanguage = {
        english: [],
        portuguese: []
    };

    recipientsWithTokens.forEach(user => {
        const token = user.effectiveToken;
        if (token) {
            const lang = userLanguageMap[user._id.toString()] || 'portuguese'; // Default to Portuguese
            if (lang === 'english') {
                tokensByLanguage.english.push(token);
            } else {
                tokensByLanguage.portuguese.push(token);
            }
        }
    });
    
    const uniqueEnglishTokens = [...new Set(tokensByLanguage.english)];
    const uniquePortugueseTokens = [...new Set(tokensByLanguage.portuguese)];

    const pushPromises = [];

    if (uniqueEnglishTokens.length > 0) {
        // console.log(`[Document Push] Sending English to ${uniqueEnglishTokens.length} unique devices`);
        pushPromises.push(
            sendPushNotificationFirebase(uniqueEnglishTokens, titles.english, bodies.english, data)
        );
    }
    if (uniquePortugueseTokens.length > 0) {
        // console.log(`[Document Push] Sending Portuguese to ${uniquePortugueseTokens.length} unique devices`);
        pushPromises.push(
            sendPushNotificationFirebase(uniquePortugueseTokens, titles.portuguese, bodies.portuguese, data)
        );
    }
    
    if (pushPromises.length === 0) {
        // console.warn("[Document Push] No valid FCM tokens found for any recipients in specified languages");
        return;
    }

    return Promise.all(pushPromises);

  } catch (error) {
    console.error("[Document Push] Error:", error);
  }
};

const uploadFile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "a user";

  try {
    if (!req.file) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "No file uploaded" });
    }

    const fileUrl = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!fileUrl) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "File upload failed" });
    }

    const document = new Document({
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user, // Assuming req.body.user contains the ID of the uploading user
      status: "pending",
    });

    await document.save({ session });

    if (req.body.projName) {
      const {
        recipients: usersForNotification, // Renamed for clarity, contains full user objects
        recipientIds: userIdsForInApp,
        project,
      } = await getDocumentNotificationRecipients(
        req.body.projName,
        performingUserId
      );

      if (project && usersForNotification.length > 0) {
        const allUserIds = usersForNotification.map(u => u._id.toString());
        const userLanguageMap = await getUserLanguagePreferences(allUserIds);

        // In-App Notifications
        if (userIdsForInApp.size > 0) {
          const inAppNotificationObjects = [];
          userIdsForInApp.forEach(userIdStr => {
            const lang = userLanguageMap[userIdStr] || 'portuguese';
            const title = lang === 'english'
              ? `New Document Available for "${project.projectName}"`
              : `Novo Documento Disponível para "${project.projectName}"`;
            const description = lang === 'english'
              ? `A new document "${document.fileName}" has been uploaded to project "${project.projectName}" by ${performingUserName}.`
              : `Um novo documento "${document.fileName}" foi carregado no Projecto "${project.projectName}" por ${performingUserName}.`;
            const lengthyDesc = lang === 'english'
              ? `We would like to inform you that a new document "${document.fileName}" has been uploaded to the project "${project.projectName}" by ${performingUserName}. To view or download the document, please access the project's section on the platform. Should you have any questions or require assistance, our team remains at your disposal.\nBest regards,\nSoapro Team`
              : `Gostaríamos de informar que um novo documento "${document.fileName}" foi carregado no Projecto "${project.projectName}" por ${performingUserName}. Para visualizar ou baixar o documento, acesse a seção do Projecto na plataforma. Caso tenha alguma dúvida ou precise de assistência, nossa equipa permanece à sua disposição.\nCom os melhores cumprimentos,\nEquipa Soapro`;
            
            inAppNotificationObjects.push({
              title,
              type: "Document Upload",
              description,
              lengthyDesc,
              memberId: new mongoose.Types.ObjectId(userIdStr),
              projectId: project._id,
            });
          });
          await ShowNotification.create(inAppNotificationObjects, {
            session,
            ordered: true, // Consider setting to false if order doesn't strictly matter for performance
          });
        }

        // Push Notifications
        await sendDocumentPushNotifications(
            usersForNotification,
            { // Titles
                english: "New Document Uploaded",
                portuguese: "Novo Documento Carregado"
            },
            { // Bodies
                english: `Document "${document.fileName}" uploaded to project "${project.projectName}" by ${performingUserName}.`,
                portuguese: `Documento "${document.fileName}" carregado no Projecto "${project.projectName}" por ${performingUserName}.`
            },
            { // Data
              projectId: project._id.toString(),
              documentId: document._id.toString(),
              documentName: document.fileName,
              type: "Document Upload",
            },
            userLanguageMap
        );
        
        // Email Notifications
        const emailPromises = usersForNotification
          .filter((user) => user.email)
          .map((user) => {
            const lang = userLanguageMap[user._id.toString()] || 'portuguese';
            const subject = lang === 'english'
                ? `New File Uploaded for Project: ${project.projectName}`
                : `Novo Ficheiro Carregado para o Projecto: ${project.projectName}`;
            const htmlBody = lang === 'english'
                ? `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>New Document Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: center;"><h2 style="color: #333;">New Document Available</h2><p style="font-size: 16px; color: #555;">Dear <strong>${user.userName || "User"}</strong>,</p><p style="font-size: 16px; color: #555;">A new document titled <strong>"${document.fileName}"</strong> has been uploaded to project <strong>"${project.projectName}"</strong> by ${performingUserName}.</p><p style="font-size: 16px; color: #555;">You can access it through the platform.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions or require assistance, our team is available to support you.</p><p style="font-size: 14px; color: #999;">Best regards,<br><strong>Soapro Team</strong></p></td></tr></table></body></html>`
                : `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Notificação de Novo Documento</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: center;"><h2 style="color: #333;">Novo Documento Disponível</h2><p style="font-size: 16px; color: #555;">Caro(a) <strong>${user.userName || "Utilizador"}</strong>,</p><p style="font-size: 16px; color: #555;">Um novo documento intitulado <strong>"${document.fileName}"</strong> foi carregado no Projecto <strong>"${project.projectName}"</strong> por ${performingUserName}.</p><p style="font-size: 16px; color: #555;">Pode acedê-lo através da plataforma.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">Se tiver alguma dúvida ou necessitar de assistência, a nossa equipa está disponível para o apoiar.</p><p style="font-size: 14px; color: #999;">Com os melhores cumprimentos,<br><strong>Equipa Soapro</strong></p></td></tr></table></body></html>`;
            
            const emailDetails = {
              from: process.env.EMAIL_FROM || process.env.EMAIL_USER, // Prefer EMAIL_FROM
              to: user.email,
              subject: subject,
              html: htmlBody,
            };
            return SendEmailUtil(emailDetails).catch((e) =>
              console.error(`Email send error to ${user.email}:`, e.message)
            );
          });
        await Promise.all(emailPromises);

      } else {
        // console.warn(
        //   `[UploadFile] Project "${req.body.projName}" not found or no recipients, skipping notifications.`
        // );
      }
    }

    await session.commitTransaction();
    res.status(201).json({ message: "File uploaded successfully!", document });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error.message, error.stack);
    res
      .status(500)
      .json({ message: "Error uploading file", error: error.message });
  } finally {
    session.endSession();
  }
};

const getDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const projectQuery = !isMain
      ? {
          $or: [
            { members: loggedInUserId },
            { "projectOwners.ownerId": loggedInUserId },
          ],
        }
      : {};

    const assignedProjects = await editProject
      .find(projectQuery)
      .select("projectName projectBanner")
      .sort({ createdAt: -1 })
      .lean();

    if (!isMain && assignedProjects.length === 0) {
      return res.status(200).json([]);
    }

    const projectMap = assignedProjects.reduce((acc, proj) => {
      acc[proj.projectName] = proj.projectBanner;
      return acc;
    }, {});

    const documentQueryCriteria = isMain
      ? {}
      : { projName: { $in: Object.keys(projectMap) } };

    const documents = await Document.find(documentQueryCriteria)
      .sort({ uploadedAt: -1 }) // Make sure 'uploadedAt' or 'createdAt' exists and is indexed
      .lean();

    const documentsWithBanner = documents.map((doc) => ({
      ...doc,
      projectBanner: projectMap[doc.projName] || [],
    }));

    res.status(200).json(documentsWithBanner);
  } catch (error) {
    console.error("Error fetching documents:", error.message, error.stack);
    res
      .status(500)
      .json({ message: "Failed to fetch documents", error: error.message });
  }
};

const updateStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "a user";

  try {
    const { id } = req.params;
    const updates = req.body; // e.g., { status: "approved", reviewComment: "Looks good" }

    if (
      updates.status &&
      !["pending", "approved", "rejected", "archived", "review"].includes(
        updates.status
      )
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Invalid status value." });
    }

    const existingDocument = await Document.findById(id).session(session);
    if (!existingDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const updatedDocument = await Document.findByIdAndUpdate(
      id,
      { $set: updates },
      {
        new: true,
        runValidators: true,
        session,
      }
    );

    if (!updatedDocument) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ message: "Document update failed unexpectedly." });
    }

    if (updatedDocument.projName) {
      const {
        recipients: usersForNotification,
        recipientIds: userIdsForInApp,
        project,
      } = await getDocumentNotificationRecipients(
        updatedDocument.projName,
        performingUserId
      );

      if (project && usersForNotification.length > 0) {
        const allUserIds = usersForNotification.map(u => u._id.toString());
        const userLanguageMap = await getUserLanguagePreferences(allUserIds);

        // In-App Notifications
        if (userIdsForInApp.size > 0) {
            const inAppNotificationObjects = [];
            userIdsForInApp.forEach(userIdStr => {
                const lang = userLanguageMap[userIdStr] || 'portuguese';
                const title = lang === 'english'
                    ? `Document Status Updated for "${project.projectName}"`
                    : `Estado do Documento Actualizado para "${project.projectName}"`;
                const description = lang === 'english'
                    ? `Document "${updatedDocument.fileName}" status changed to "${updatedDocument.status}" by ${performingUserName}.`
                    : `O estado do documento "${updatedDocument.fileName}" foi alterado para "${updatedDocument.status}" por ${performingUserName}.`;
                const lengthyDesc = lang === 'english'
                    ? `The status of document "${updatedDocument.fileName}" in project "${project.projectName}" has been updated to "${updatedDocument.status}" by ${performingUserName}. Please review the changes as needed.\nBest regards,\nSoapro Team`
                    : `O estado do documento "${updatedDocument.fileName}" no Projecto "${project.projectName}" foi Actualizado para "${updatedDocument.status}" por ${performingUserName}. Por favor, reveja as alterações conforme necessário.\nCom os melhores cumprimentos,\nEquipa Soapro`;

                inAppNotificationObjects.push({
                    title,
                    type: "Document Update",
                    description,
                    lengthyDesc,
                    memberId: new mongoose.Types.ObjectId(userIdStr),
                    projectId: project._id,
                });
            });
            await ShowNotification.create(inAppNotificationObjects, {
                session,
                ordered: true, // Consider setting to false
            });
        }
        
        // Push Notifications
        await sendDocumentPushNotifications(
            usersForNotification,
            { // Titles
                english: "Document Status Updated",
                portuguese: "Estado do Documento Actualizado"
            },
            { // Bodies
                english: `Doc "${updatedDocument.fileName}" in "${project.projectName}" status: ${updatedDocument.status}. By ${performingUserName}.`,
                portuguese: `Doc "${updatedDocument.fileName}" no Projecto "${project.projectName}" estado: ${updatedDocument.status}. Por ${performingUserName}.`
            },
            { // Data
              projectId: project._id.toString(),
              documentId: updatedDocument._id.toString(),
              documentName: updatedDocument.fileName,
              newStatus: updatedDocument.status,
              type: "Document Status Update",
            },
            userLanguageMap
        );

        // Email Notifications
        const emailPromises = usersForNotification
          .filter((user) => user.email)
          .map((user) => {
            const lang = userLanguageMap[user._id.toString()] || 'portuguese';
            const subject = lang === 'english'
                ? `Document Status Updated: ${updatedDocument.fileName}`
                : `Estado do Documento Actualizado: ${updatedDocument.fileName}`;
            const htmlBody = lang === 'english'
                ? `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Document Status Update</title></head><body style="font-family: Arial, sans-serif; padding: 20px;"><p>Dear <strong>${user.userName || "User"}</strong>,</p><p>The status of document <strong>"${updatedDocument.fileName}"</strong> in project <strong>"${project.projectName}"</strong> has been updated to <strong>"${updatedDocument.status}"</strong> by ${performingUserName}.</p>${updates.reviewComment ? `<p>Comment: ${updates.reviewComment}</p>` : ''}<p>Regards,<br>The Soapro Team</p></body></html>`
                : `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Atualização do Estado do Documento</title></head><body style="font-family: Arial, sans-serif; padding: 20px;"><p>Caro(a) <strong>${user.userName || "Utilizador"}</strong>,</p><p>O estado do documento <strong>"${updatedDocument.fileName}"</strong> no Projecto <strong>"${project.projectName}"</strong> foi Actualizado para <strong>"${updatedDocument.status}"</strong> por ${performingUserName}.</p>${updates.reviewComment ? `<p>Comentário: ${updates.reviewComment}</p>` : ''}<p>Com os melhores cumprimentos,<br>A Equipa Soapro</p></body></html>`;

            const emailDetails = {
              from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
              to: user.email,
              subject: subject,
              html: htmlBody,
            };
            return SendEmailUtil(emailDetails).catch((e) =>
              console.error(`Email send error to ${user.email}:`, e.message)
            );
          });
        await Promise.all(emailPromises);

      } else {
        // console.warn(
        //   `[UpdateStatus] Project "${updatedDocument.projName}" not found or no recipients, skipping notifications.`
        // );
      }
    }

    await session.commitTransaction();

    let successMessage = "Document updated successfully";
    if (updates.status === "approved") {
      successMessage = "Report successfully approved";
    } else if (updates.status === "rejected") {
      successMessage = "Report successfully rejected";
    }
     
    res.status(200).json({
      message: successMessage,
      document: updatedDocument,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error in updateStatus:", error.message, error.stack);
    res.status(500).json({
      message: "Error updating document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const deleteDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "a user";

  try {
    const document = await Document.findById(req.params.id).session(session);
    if (!document) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const { projName, fileName, _id: documentId, fileUrl } = document;

    if (fileUrl) {
      const fileKey = fileUrl.split(".com/")[1]; // Basic parsing, might need improvement for different S3 URL formats
      if (fileKey) {
        await deleteFromS3(fileKey);
      } else {
        // console.warn(
        //   `[DeleteDocument] Could not parse fileKey from S3 URL: ${fileUrl}`
        // );
      }
    }

    await Document.findByIdAndDelete(req.params.id, { session });

    if (projName) {
      const {
        recipients: usersForNotification,
        recipientIds: userIdsForInApp,
        project,
      } = await getDocumentNotificationRecipients(projName, performingUserId);

      if (project && usersForNotification.length > 0) {
        const allUserIds = usersForNotification.map(u => u._id.toString());
        const userLanguageMap = await getUserLanguagePreferences(allUserIds);
        
        // In-App Notifications
        if (userIdsForInApp.size > 0) {
            const inAppNotificationObjects = [];
            userIdsForInApp.forEach(userIdStr => {
                const lang = userLanguageMap[userIdStr] || 'portuguese';
                const title = lang === 'english'
                    ? `Document Deleted from "${project.projectName}"`
                    : `Documento Eliminado de "${project.projectName}"`;
                const description = lang === 'english'
                    ? `Document "${fileName}" was deleted from project "${project.projectName}" by ${performingUserName}.`
                    : `O documento "${fileName}" foi eliminado do Projecto "${project.projectName}" por ${performingUserName}.`;
                const lengthyDesc = lang === 'english'
                    ? `The document "${fileName}" has been deleted from project "${project.projectName}" by ${performingUserName}.\nIf this was unexpected, please contact support.\nBest regards,\nSoapro Team`
                    : `O documento "${fileName}" foi eliminado do Projecto "${project.projectName}" por ${performingUserName}.\nSe isto foi inesperado, por favor contacte o suporte.\nCom os melhores cumprimentos,\nEquipa Soapro`;

                inAppNotificationObjects.push({
                    title,
                    type: "Document Deletion",
                    description,
                    lengthyDesc,
                    memberId: new mongoose.Types.ObjectId(userIdStr),
                    projectId: project._id,
                });
            });
            await ShowNotification.create(inAppNotificationObjects, {
                session,
                ordered: true, // Consider setting to false
            });
        }
        
        // Push Notifications
        await sendDocumentPushNotifications(
            usersForNotification,
            { // Titles
                english: "Document Deleted",
                portuguese: "Documento Eliminado"
            },
            { // Bodies
                english: `Doc "${fileName}" deleted from project "${project.projectName}" by ${performingUserName}.`,
                portuguese: `Doc "${fileName}" eliminado do Projecto "${project.projectName}" por ${performingUserName}.`
            },
            { // Data
              projectId: project._id.toString(),
              documentId: documentId.toString(),
              documentName: fileName,
              type: "Document Deletion",
            },
            userLanguageMap
        );

        // Email Notifications
        const emailPromises = usersForNotification
          .filter((user) => user.email)
          .map((user) => {
            const lang = userLanguageMap[user._id.toString()] || 'portuguese';
            const subject = lang === 'english'
                ? `Document Deleted: ${fileName}`
                : `Documento Eliminado: ${fileName}`;
            const htmlBody = lang === 'english'
                ? `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Document Deletion</title></head><body style="font-family: Arial, sans-serif; padding: 20px;"><p>Dear <strong>${user.userName || "User"}</strong>,</p><p>The document <strong>"${fileName}"</strong> in project <strong>"${project.projectName}"</strong> has been deleted by ${performingUserName}.</p><p>Regards,<br>The Soapro Team</p></body></html>`
                : `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Eliminação de Documento</title></head><body style="font-family: Arial, sans-serif; padding: 20px;"><p>Caro(a) <strong>${user.userName || "Utilizador"}</strong>,</p><p>O documento <strong>"${fileName}"</strong> no Projecto <strong>"${project.projectName}"</strong> foi eliminado por ${performingUserName}.</p><p>Com os melhores cumprimentos,<br>A Equipa Soapro</p></body></html>`;

            const emailDetails = {
              from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
              to: user.email,
              subject: subject,
              html: htmlBody,
            };
            return SendEmailUtil(emailDetails).catch((e) =>
              console.error(`Email send error to ${user.email}:`, e.message)
            );
          });
        await Promise.all(emailPromises);

      } else {
        // console.warn(
        //   `[DeleteDocument] Project "${projName}" not found or no recipients, skipping notifications.`
        // );
      }
    }

    await session.commitTransaction();
    res.status(200).json({ message: "Document deleted successfully!" });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting document:", error.message, error.stack);
    res.status(500).json({
      message: "Error deleting document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export { uploadFile, getDocuments, updateStatus, deleteDocument };