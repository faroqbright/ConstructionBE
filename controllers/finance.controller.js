import mongoose from "mongoose";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import { User } from "../models/user.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

// Helper function to get user language preference
async function getUserLanguage(userId) {
  const preference = await LanguagePreference.findOne({ userId }).lean();
  return preference?.languageSelected || "portuguese"; // Default to Portuguese
}

// Helper function to get FCM tokens from User model with language support
const getFcmTokensForUser = async (userId) => {
  try {
    const user = await User.findById(userId)
      .select("notificationToken fcmDeviceToken")
      .lean();

    if (!user) {
      console.warn(`User not found for ID ${userId}`);
      return { tokens: [], language: "portuguese" };
    }

    const token = user.notificationToken || user.fcmDeviceToken;
    const language = await getUserLanguage(userId);

    return {
      tokens: token ? [token] : [],
      language,
    };
  } catch (error) {
    console.error(`Error getting FCM tokens for user ${userId}:`, error);
    return { tokens: [], language: "portuguese" };
  }
};

// Enhanced helper function to send localized push notifications
const sendPushNotificationsToUsers = async (userIds, title, body, data) => {
  try {
    if (!userIds || userIds.length === 0) {
      console.warn("No user IDs provided for push notifications.");
      return;
    }

    // Get tokens and language preferences for all users
    const userPromises = userIds.map((userId) => getFcmTokensForUser(userId));
    const usersData = await Promise.all(userPromises);

    // Group tokens by language
    const tokensByLanguage = {
      portuguese: [],
      english: [],
    };

    usersData.forEach((user) => {
      if (user.language === "portuguese") {
        tokensByLanguage.portuguese.push(...user.tokens);
      } else {
        tokensByLanguage.english.push(...user.tokens);
      }
    });

    // Send notifications for each language group
    const sendPromises = [];

    if (tokensByLanguage.portuguese.length > 0) {
      const portugueseTitle =
        typeof title === "object" ? title.portuguese : title;
      const portugueseBody = typeof body === "object" ? body.portuguese : body;

      sendPromises.push(
        sendPushNotification(
          tokensByLanguage.portuguese,
          portugueseTitle,
          portugueseBody,
          data
        )
      );
    }

    if (tokensByLanguage.english.length > 0) {
      const englishTitle = typeof title === "object" ? title.english : title;
      const englishBody = typeof body === "object" ? body.english : body;

      sendPromises.push(
        sendPushNotification(
          tokensByLanguage.english,
          englishTitle,
          englishBody,
          data
        )
      );
    }

    await Promise.all(sendPromises);
  } catch (error) {
    console.error("Error in sendPushNotificationsToUsers:", error);
  }
};

// Helper function to send localized emails
async function sendFinanceDocumentEmail(
  recipients,
  documentInfo,
  projectInfo,
  performingUser,
  actionType
) {
  const emailPromises = recipients.map(async (recipient) => {
    if (!recipient.email) return;

    const userLanguage = await getUserLanguage(recipient._id);
    const isPortuguese = userLanguage === "portuguese";

    let subject, html;

    if (actionType === "upload") {
      subject = isPortuguese
        ? `Novo Documento Financeiro Enviado: ${documentInfo.fileName}`
        : `New Finance Document Uploaded: ${documentInfo.fileName}`;

      html = isPortuguese
        ? `
          <!DOCTYPE html>
          <html lang="pt">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">Novo Documento Financeiro</h2>
                  <p style="font-size: 16px; color: #555;">Prezado(a) <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">Um novo documento financeiro chamado <strong>"${documentInfo.fileName}"</strong> foi enviado para o projeto <strong>"${projectInfo.projectName}"</strong> por <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">Por favor, acesse sua conta para visualizar ou baixar o documento.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Atenciosamente,<br><strong>Equipe Soapro</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
        : `
          <!DOCTYPE html>
          <html lang="en">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">New Finance Document</h2>
                  <p style="font-size: 16px; color: #555;">Dear <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">A new finance document titled <strong>"${documentInfo.fileName}"</strong> has been uploaded to project <strong>"${projectInfo.projectName}"</strong> by <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">Please log in to your account to view or download the document.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Best regards,<br><strong>Soapro Team</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;
    } else if (actionType === "update") {
      subject = isPortuguese
        ? `Documento Financeiro Atualizado: ${documentInfo.fileName}`
        : `Finance Document Updated: ${documentInfo.fileName}`;

      html = isPortuguese
        ? `
          <!DOCTYPE html>
          <html lang="pt">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">Documento Financeiro Atualizado</h2>
                  <p style="font-size: 16px; color: #555;">Prezado(a) <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">O documento financeiro <strong>"${documentInfo.fileName}"</strong> no projeto <strong>"${projectInfo.projectName}"</strong> foi atualizado por <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">Você pode visualizar o documento atualizado acessando a plataforma.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Atenciosamente,<br><strong>Equipe Soapro</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
        : `
          <!DOCTYPE html>
          <html lang="en">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">Finance Document Updated</h2>
                  <p style="font-size: 16px; color: #555;">Dear <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">The finance document <strong>"${documentInfo.fileName}"</strong> in project <strong>"${projectInfo.projectName}"</strong> has been updated by <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">You can view the updated document by logging into the platform.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Best regards,<br><strong>Soapro Team</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;
    } else if (actionType === "delete") {
      subject = isPortuguese
        ? `Documento Financeiro Removido: ${documentInfo.fileName}`
        : `Finance Document Deleted: ${documentInfo.fileName}`;

      html = isPortuguese
        ? `
          <!DOCTYPE html>
          <html lang="pt">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">Documento Financeiro Removido</h2>
                  <p style="font-size: 16px; color: #555;">Prezado(a) <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">O documento financeiro <strong>"${documentInfo.fileName}"</strong> foi removido do projeto <strong>"${projectInfo.projectName}"</strong> por <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">Este documento não estará mais disponível na plataforma.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Atenciosamente,<br><strong>Equipe Soapro</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `
        : `
          <!DOCTYPE html>
          <html lang="en">
          <head><meta charset="UTF-8"></head>
          <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
              <tr>
                <td style="padding: 20px; text-align: left;">
                  <h2 style="color: #333;">Finance Document Deleted</h2>
                  <p style="font-size: 16px; color: #555;">Dear <strong>${recipient.userName}</strong>,</p>
                  <p style="font-size: 16px; color: #555;">The finance document <strong>"${documentInfo.fileName}"</strong> has been deleted from project <strong>"${projectInfo.projectName}"</strong> by <strong>${performingUser.userName}</strong>.</p>
                  <p style="font-size: 16px; color: #555;">This document will no longer be available on the platform.</p>
                  <p style="font-size: 14px; color: #999; margin-top: 30px;">Best regards,<br><strong>Soapro Team</strong></p>
                </td>
              </tr>
            </table>
          </body>
          </html>
        `;
    }

    try {
      await SendEmailUtil({
        from: process.env.EMAIL_FROM || "noreply@soapro.com",
        to: recipient.email,
        subject,
        html,
      });
    } catch (err) {
      console.error(`Error sending email to ${recipient.email}:`, err.message);
    }
  });

  await Promise.all(emailPromises);
}

// Upload Finance Document with localized notifications
export const uploadFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUser = req.user;

  try {
    if (!req.file) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "No file uploaded" });
    }

    const {
      projName,
      user,
      financialExecution,
      physicalExecution,
      fileName,
      reference,
    } = req.body;

    // Validation checks...
    const project = await editProject
      .findOne({ projectName: projName })
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .session(session);

    if (!project) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Project not found" });
    }

    const finalFileName = fileName.includes(".")
      ? fileName
      : `${fileName}.${req.file.mimetype.split("/")[1]}`;
    const fileUrl = await uploadToS3(
      req.file.buffer,
      finalFileName,
      req.file.mimetype
    );

    const financeDocument = new FinanceDocument({
      projName,
      fileName: finalFileName,
      fileUrl,
      user,
      financialExecution,
      physicalExecution,
      reference,
      uploadedAt: new Date(),
      uploadedBy: performingUser._id,
    });

    await financeDocument.save({ session });

    // Prepare recipients for notifications
    const recipients = [
      ...project.projectOwners.map((owner) => ({
        _id: owner.ownerId._id,
        email: owner.ownerId.email,
        userName: owner.ownerId.userName,
      })),
      ...project.members.map((member) => ({
        _id: member._id,
        email: member.email,
        userName: member.userName,
      })),
      {
        _id: performingUser._id,
        email: performingUser.email,
        userName: performingUser.userName,
      },
    ].filter(
      (v, i, a) =>
        a.findIndex((t) => t._id.toString() === v._id.toString()) === i
    );

    // Create localized in-app notifications
    const notificationPromises = recipients.map(async (recipient) => {
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";

      return {
        title: isPortuguese
          ? `Novo Documento Financeiro Enviado: "${finalFileName}"`
          : `New Finance Document Uploaded: "${finalFileName}"`,
        type: "Document Upload",
        description: isPortuguese
          ? `Um novo documento financeiro "${finalFileName}" foi enviado para o projeto "${projName}" por ${performingUser.userName}`
          : `A new finance document "${finalFileName}" was uploaded for project "${projName}" by ${performingUser.userName}`,
        lengthyDesc: isPortuguese
          ? `Informamos que um novo documento financeiro "${finalFileName}" foi enviado para o projeto "${projName}". Para visualizar ou baixar o documento, acesse a seção do projeto na plataforma. Em caso de dúvidas, nossa equipe está à disposição.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that a new finance document "${finalFileName}" was uploaded for project "${projName}". To view or download the document, please access the project section on the platform. Should you have any questions, our team remains at your disposal.//
          Best regards,//
          [Soapro Team]`,
        memberId: recipient._id,
        projectId: project._id,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications, { session });

    await session.commitTransaction();

    // Send localized push notifications
    await sendPushNotificationsToUsers(
      recipients.map((r) => r._id),
      {
        portuguese: `Novo Documento Financeiro: ${finalFileName}`,
        english: `New Finance Document: ${finalFileName}`,
      },
      {
        portuguese: `Documento "${finalFileName}" enviado para o projeto "${projName}" por ${performingUser.userName}`,
        english: `Document "${finalFileName}" uploaded to project "${projName}" by ${performingUser.userName}`,
      },
      {
        type: "FINANCE_DOCUMENT_UPLOADED",
        projectId: project._id.toString(),
        documentId: financeDocument._id.toString(),
        documentName: finalFileName,
      }
    );

    // Send localized emails
    await sendFinanceDocumentEmail(
      recipients,
      { fileName: finalFileName },
      project,
      performingUser,
      "upload"
    );

    res.status(201).json({
      message: "File uploaded successfully!",
      financeDocument,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error);
    res.status(500).json({
      message: "Error uploading file",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Update Finance Document with localized notifications
export const updateFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUser = req.user;

  try {
    const { id } = req.params;
    const updates = {};
    const existingDocument =
      await FinanceDocument.findById(id).session(session);

    if (!existingDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    // Update logic...

    const project = await editProject
      .findOne({ projectName: existingDocument.projName })
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .session(session);

    const updatedDocument = await FinanceDocument.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, session }
    );

    // Prepare recipients
    const recipients = [
      ...(project?.projectOwners?.map((owner) => ({
        _id: owner.ownerId._id,
        email: owner.ownerId.email,
        userName: owner.ownerId.userName,
      })) || []),
      ...(project?.members?.map((member) => ({
        _id: member._id,
        email: member.email,
        userName: member.userName,
      })) || []),
      {
        _id: performingUser._id,
        email: performingUser.email,
        userName: performingUser.userName,
      },
    ].filter(
      (v, i, a) =>
        a.findIndex((t) => t._id.toString() === v._id.toString()) === i
    );

    // Create localized in-app notifications
    const notificationPromises = recipients.map(async (recipient) => {
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";

      return {
        title: isPortuguese
          ? `Documento Financeiro Atualizado: "${existingDocument.fileName}"`
          : `Finance Document Updated: "${existingDocument.fileName}"`,
        type: "Document Update",
        description: isPortuguese
          ? `O documento financeiro "${existingDocument.fileName}" no projeto "${project?.projectName}" foi atualizado por ${performingUser.userName}`
          : `The finance document "${existingDocument.fileName}" in project "${project?.projectName}" was updated by ${performingUser.userName}`,
        lengthyDesc: isPortuguese
          ? `Informamos que o documento financeiro "${existingDocument.fileName}" foi atualizado no projeto "${project?.projectName}". Para visualizar as alterações, acesse a plataforma.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that the finance document "${existingDocument.fileName}" was updated in project "${project?.projectName}". Please check the platform for changes.//
          Best regards,//
          [Soapro Team]`,
        memberId: recipient._id,
        projectId: project?._id,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications, { session });

    await session.commitTransaction();

    // Send localized push notifications
    await sendPushNotificationsToUsers(
      recipients.map((r) => r._id),
      {
        portuguese: `Documento Atualizado: ${existingDocument.fileName}`,
        english: `Document Updated: ${existingDocument.fileName}`,
      },
      {
        portuguese: `Documento "${existingDocument.fileName}" atualizado no projeto "${project?.projectName}" por ${performingUser.userName}`,
        english: `Document "${existingDocument.fileName}" updated in project "${project?.projectName}" by ${performingUser.userName}`,
      },
      {
        type: "FINANCE_DOCUMENT_UPDATED",
        projectId: project?._id.toString(),
        documentId: updatedDocument._id.toString(),
        documentName: existingDocument.fileName,
      }
    );

    // Send localized emails
    await sendFinanceDocumentEmail(
      recipients,
      { fileName: existingDocument.fileName },
      project,
      performingUser,
      "update"
    );

    res.status(200).json({
      message: "Document updated successfully!",
      document: updatedDocument,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error updating document:", error);
    res.status(500).json({
      message: "Error updating document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// Delete Finance Document with localized notifications
export const deleteFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUser = req.user;

  try {
    const document = await FinanceDocument.findById(req.params.id).session(
      session
    );
    if (!document) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const project = await editProject
      .findOne({ projectName: document.projName })
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .session(session);

    // S3 deletion logic...

    await FinanceDocument.findByIdAndDelete(req.params.id, { session });

    // Prepare recipients
    const recipients = [
      ...(project?.projectOwners?.map((owner) => ({
        _id: owner.ownerId._id,
        email: owner.ownerId.email,
        userName: owner.ownerId.userName,
      })) || []),
      ...(project?.members?.map((member) => ({
        _id: member._id,
        email: member.email,
        userName: member.userName,
      })) || []),
      {
        _id: performingUser._id,
        email: performingUser.email,
        userName: performingUser.userName,
      },
    ].filter(
      (v, i, a) =>
        a.findIndex((t) => t._id.toString() === v._id.toString()) === i
    );

    // Create localized in-app notifications
    const notificationPromises = recipients.map(async (recipient) => {
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";

      return {
        title: isPortuguese
          ? `Documento Financeiro Removido: "${document.fileName}"`
          : `Finance Document Deleted: "${document.fileName}"`,
        type: "Document Deletion",
        description: isPortuguese
          ? `O documento financeiro "${document.fileName}" foi removido do projeto "${project?.projectName}" por ${performingUser.userName}`
          : `The finance document "${document.fileName}" was deleted from project "${project?.projectName}" by ${performingUser.userName}`,
        lengthyDesc: isPortuguese
          ? `Informamos que o documento financeiro "${document.fileName}" foi removido permanentemente do projeto "${project?.projectName}". Este documento não estará mais disponível na plataforma.//
          Atenciosamente,//
          [Equipe Soapro]`
          : `We would like to inform you that the finance document "${document.fileName}" was permanently deleted from project "${project?.projectName}". This document will no longer be available on the platform.//
          Best regards,//
          [Soapro Team]`,
        memberId: recipient._id,
        projectId: project?._id,
      };
    });

    const notifications = await Promise.all(notificationPromises);
    await ShowNotification.create(notifications, { session });

    await session.commitTransaction();

    // Send localized push notifications
    await sendPushNotificationsToUsers(
      recipients.map((r) => r._id),
      {
        portuguese: `Documento Removido: ${document.fileName}`,
        english: `Document Deleted: ${document.fileName}`,
      },
      {
        portuguese: `Documento "${document.fileName}" removido do projeto "${project?.projectName}" por ${performingUser.userName}`,
        english: `Document "${document.fileName}" deleted from project "${project?.projectName}" by ${performingUser.userName}`,
      },
      {
        type: "FINANCE_DOCUMENT_DELETED",
        projectId: project?._id.toString(),
        documentName: document.fileName,
      }
    );

    // Send localized emails
    await sendFinanceDocumentEmail(
      recipients,
      { fileName: document.fileName },
      project,
      performingUser,
      "delete"
    );

    res.status(200).json({ message: "Document deleted successfully!" });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting document:", error);
    res.status(500).json({
      message: "Error deleting document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

// getFinanceDocuments remains unchanged as it doesn't involve notifications
export const getFinanceDocuments = async (req, res) => {
  try {
    // Existing implementation...
  } catch (error) {
    console.error("Error fetching finance documents:", error);
    res.status(500).json({
      message: "Failed to fetch finance documents",
      error: error.message,
    });
  }
};

// export {
//   uploadFinanceDocument,
//   getFinanceDocuments,
//   updateFinanceDocument,
//   deleteFinanceDocument,
// };
