import mongoose from "mongoose";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import { User } from "../models/user.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { sendNotification as sendPushNotificationFirebase } from "../utils/firebase.service.js"; // Renamed for clarity
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js"; // Assuming this model exists

// --- HELPER FUNCTIONS FOR LOCALIZED NOTIFICATIONS ---

// Helper function to get user language preference
async function getUserLanguage(userId) {
  if (!userId) return "portuguese"; // Default if no userId
  try {
    const preference = await LanguagePreference.findOne({ userId }).lean();
    return preference?.languageSelected || "portuguese"; // Default to Portuguese
  } catch (error) {
    console.warn(
      `Error fetching language preference for user ${userId}, defaulting to portuguese:`,
      error.message
    );
    return "portuguese";
  }
}

// Helper to get full user objects for notification
async function getFinanceNotificationRecipients(project, performingUserIdStr) {
  const recipientUserObjects = [];
  const recipientUserObjectIds = new Set(); // To track added user IDs

  // Ensure project and its properties are defined
  if (!project) {
    console.warn("[getFinanceNotificationRecipients] Project is undefined.");
    return [];
  }

  // Process members
  if (project.members && Array.isArray(project.members)) {
    project.members.forEach((member) => {
      if (
        member &&
        member._id &&
        !recipientUserObjectIds.has(member._id.toString())
      ) {
        const token = member.notificationToken || member.fcmDeviceToken;
        recipientUserObjects.push({
          ...(member.toObject ? member.toObject() : member),
          effectiveToken: token,
        });
        recipientUserObjectIds.add(member._id.toString());
      }
    });
  }

  // Process owners
  if (project.projectOwners && Array.isArray(project.projectOwners)) {
    project.projectOwners.forEach((ownerObj) => {
      if (
        ownerObj &&
        ownerObj.ownerId &&
        ownerObj.ownerId._id &&
        !recipientUserObjectIds.has(ownerObj.ownerId._id.toString())
      ) {
        const token =
          ownerObj.ownerId.notificationToken || ownerObj.ownerId.fcmDeviceToken;
        recipientUserObjects.push({
          ...(ownerObj.ownerId.toObject
            ? ownerObj.ownerId.toObject()
            : ownerObj.ownerId),
          effectiveToken: token,
        });
        recipientUserObjectIds.add(ownerObj.ownerId._id.toString());
      }
    });
  }

  // Add performing user if not already included and valid
  if (
    performingUserIdStr &&
    !recipientUserObjectIds.has(performingUserIdStr.toString())
  ) {
    try {
      const performer = await User.findById(performingUserIdStr)
        .select("_id notificationToken fcmDeviceToken email userName")
        .lean();
      if (performer) {
        const token = performer.notificationToken || performer.fcmDeviceToken;
        recipientUserObjects.push({ ...performer, effectiveToken: token });
        recipientUserObjectIds.add(performer._id.toString());
      }
    } catch (error) {
      console.error(
        `Error fetching performing user ${performingUserIdStr}:`,
        error.message
      );
    }
  }
  return recipientUserObjects;
}

// New push notification sender with language support
async function sendLocalizedPushNotifications(
  recipients,
  titleObj,
  bodyObj,
  data
) {
  if (!recipients || recipients.length === 0) {
    console.warn("[sendLocalizedPushNotifications] No recipients provided.");
    return;
  }
  try {
    const recipientsByLanguage = { portuguese: [], english: [] };
    const languagePromises = recipients.map(async (user) => {
      // Ensure user and user._id are valid before calling getUserLanguage
      if (user && user._id) {
        const language = await getUserLanguage(user._id);
        return { user, language };
      }
      return { user, language: "portuguese" }; // Default if user or user._id is invalid
    });
    const usersWithLanguage = await Promise.all(languagePromises);

    usersWithLanguage.forEach(({ user, language }) => {
      if (language === "portuguese") recipientsByLanguage.portuguese.push(user);
      else recipientsByLanguage.english.push(user);
    });

    const sendPromises = [];

    if (recipientsByLanguage.portuguese.length > 0) {
      const portugueseTokens = [
        ...new Set(
          recipientsByLanguage.portuguese
            .map((u) => u.effectiveToken)
            .filter(Boolean)
        ),
      ];
      if (portugueseTokens.length > 0) {
        sendPromises.push(
          sendPushNotificationFirebase(
            portugueseTokens,
            titleObj.portuguese,
            bodyObj.portuguese,
            data
          )
        );
      }
    }
    if (recipientsByLanguage.english.length > 0) {
      const englishTokens = [
        ...new Set(
          recipientsByLanguage.english
            .map((u) => u.effectiveToken)
            .filter(Boolean)
        ),
      ];
      if (englishTokens.length > 0) {
        sendPromises.push(
          sendPushNotificationFirebase(
            englishTokens,
            titleObj.english,
            bodyObj.english,
            data
          )
        );
      }
    }
    if (sendPromises.length > 0) {
      await Promise.all(sendPromises);
      console.log(
        `Localized push notifications initiated for: ${titleObj.english} / ${titleObj.portuguese}`
      );
    } else {
      console.warn(
        "[sendLocalizedPushNotifications] No valid tokens found for any language group."
      );
    }
  } catch (error) {
    console.error("Error in sendLocalizedPushNotifications:", error);
  }
}
// --- END HELPER FUNCTIONS ---

export const uploadFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "System";

  try {
    if (!req.file) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { projName, user, financialExecution, physicalExecution, reference } = req.body;

    if (
      financialExecution < 0 ||
      financialExecution > 100 ||
      physicalExecution < 0 ||
      physicalExecution > 100
    ) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "Execution values must be between 0 and 100" });
    }

    const project = await editProject
      .findOne({ projectName: projName })
      .populate("projectOwners.ownerId", "_id email userName notificationToken fcmDeviceToken")
      .populate("members", "_id email userName notificationToken fcmDeviceToken")
      .session(session)
      .lean();

    if (!project) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Project not found" });
    }

    const fileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);

    if (!fileUrl) {
      await session.abortTransaction();
      session.endSession();
      return res.status(500).json({ message: "File upload to S3 failed" });
    }

    const finalFileName = req.body.fileName?.trim() || decodeURIComponent(fileUrl.split("/").pop());

    if (!finalFileName) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Filename could not be determined. Please provide a filename or ensure the uploaded file has a valid name.",
      });
    }

    const financeDocument = new FinanceDocument({
      projName,
      fileName: finalFileName,
      fileUrl,
      user,
      financialExecution,
      physicalExecution,
      reference,
      uploadedAt: new Date(),
      uploadedBy: performingUserId,
    });

    await financeDocument.save({ session });

    const recipients = await getFinanceNotificationRecipients(
      project,
      performingUserId ? performingUserId.toString() : null
    );

    const inAppNotifications = [];
    for (const recipient of recipients) {
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";

      const title = isPortuguese
        ? `Novo Documento Financeiro: ${finalFileName}`
        : `New Finance Document: ${finalFileName}`;
      const description = isPortuguese
        ? `Um novo documento financeiro "${finalFileName}" foi carregado para o projeto "${projName}" por ${performingUserName}.`
        : `A new finance document "${finalFileName}" was uploaded for project "${projName}" by ${performingUserName}.`;
      const lengthyDesc = isPortuguese
        ? `Informamos que um novo documento financeiro "${finalFileName}" foi carregado para o projeto "${projName}" por ${performingUserName}. Para visualizar ou baixar o documento, acesse a seção do projeto na plataforma. Em caso de dúvidas ou necessidade de assistência, nossa equipe está à disposição.//Atenciosamente,//Equipe Soapro`
        : `We would like to inform you that a new finance document "${finalFileName}" has been uploaded for project "${projName}" by ${performingUserName}. To view or download the document, please access the project's section on the platform. Should you have any questions or require assistance, our team remains at your disposal.//Best regards,//Soapro Team`;

      inAppNotifications.push({
        title,
        type: "Document Upload",
        description,
        lengthyDesc,
        memberId: recipient._id,
        projectId: project._id,
      });
    }

    if (inAppNotifications.length > 0) {
      await ShowNotification.create(inAppNotifications, { session });
    }

    await session.commitTransaction();

    await sendLocalizedPushNotifications(
      recipients,
      {
        portuguese: "Novo Documento Financeiro",
        english: "New Finance Document Uploaded",
      },
      {
        portuguese: `Arquivo "${finalFileName}" para o projeto "${projName}" carregado por ${performingUserName}.`,
        english: `File "${finalFileName}" for project "${projName}" uploaded by ${performingUserName}.`,
      },
      {
        type: "Finance Document Uploaded",
        projectId: project._id.toString(),
        documentId: financeDocument._id.toString(),
        documentName: finalFileName,
      }
    );

    for (const recipient of recipients) {
      if (!recipient.email) continue;
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";
      const subject = isPortuguese
        ? `Novo Documento Carregado para o Projeto: ${projName}`
        : `New File Uploaded for Project: ${projName}`;
      const html = isPortuguese
        ? `<html><body style="font-family: Arial, sans-serif;"><h2 style="color: #333;">Novo Documento Carregado</h2><p>Prezado(a) <strong>${recipient.userName || "Usuário"}</strong>,</p><p>Um novo arquivo chamado <strong>"${finalFileName}"</strong> foi carregado para o projeto <strong>"${projName}"</strong> por ${performingUserName}.</p><p>Por favor, acesse seu painel para visualizar ou baixar o arquivo.</p><p style="color: #888;">Atenciosamente,<br>Equipe Soapro</p></body></html>`
        : `<html><body style="font-family: Arial, sans-serif;"><h2 style="color: #333;">New File Uploaded</h2><p>Dear <strong>${recipient.userName || "User"}</strong>,</p><p>A new file named <strong>"${finalFileName}"</strong> has been uploaded for the project <strong>"${projName}"</strong> by ${performingUserName}.</p><p>Please log in to your dashboard to view or download the file.</p><p style="color: #888;">Best regards,<br>Soapro Team</p></body></html>`;
      try {
        await SendEmailUtil({
          from: process.env.EMAIL_USER,
          to: recipient.email,
          subject,
          html,
        });
      } catch (error) {
        console.error(`Failed to send email to ${recipient.email}:`, error.message);
      }
    }

    res.status(201).json({
      message: "File uploaded successfully!",
      financeDocument,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Error uploading file:", error.message, error.stack);
    res.status(500).json({
      message: "Error uploading file",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};


export const getFinanceDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject
      .find({
        ...(!isMain
          ? {
              $or: [
                { members: loggedInUserId },
                { "projectOwners.ownerId": loggedInUserId },
              ],
            }
          : {}),
      })
      .select("projectName")
      .lean(); // Only need projectName

    const projectNames = assignedProjects.map((proj) => proj.projectName);

    if (projectNames.length === 0 && !isMain) {
      return res.status(200).json([]);
    }

    const query =
      isMain && projectNames.length === 0
        ? {}
        : { projName: { $in: projectNames } };
    const financeDocuments = await FinanceDocument.find(query)
      .sort({ uploadedAt: -1 })
      .lean();

    res.status(200).json(financeDocuments);
  } catch (error) {
    console.error("Error fetching finance documents:", error.message);
    res.status(500).json({
      message: "Failed to fetch finance documents",
      error: error.message,
    });
  }
};

export const updateFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "System";

  try {
    const { id } = req.params;
    const updates = {};
    let changesMade = false;
    let changeDescriptions = { portuguese: [], english: [] };

    const existingDocument =
      await FinanceDocument.findById(id).session(session);
    if (!existingDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    let newFinancialExecution = existingDocument.financialExecution;
    let newPhysicalExecution = existingDocument.physicalExecution;

    if (Object.prototype.hasOwnProperty.call(req.body, "financialExecution")) {
      const finExec = Number.parseFloat(req.body.financialExecution);
      if (isNaN(finExec) || finExec < 0 || finExec > 100) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: "Financial Execution must be a number between 0 and 100",
        });
      }
      if (existingDocument.financialExecution !== finExec) {
        newFinancialExecution = finExec;
        changesMade = true;
        changeDescriptions.portuguese.push(
          `Execução Financeira alterada para ${finExec}%`
        );
        changeDescriptions.english.push(
          `Financial Execution changed to ${finExec}%`
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "physicalExecution")) {
      const phyExec = Number.parseFloat(req.body.physicalExecution);
      if (isNaN(phyExec) || phyExec < 0 || phyExec > 100) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          message: "Physical Execution must be a number between 0 and 100",
        });
      }
      if (existingDocument.physicalExecution !== phyExec) {
        newPhysicalExecution = phyExec;
        changesMade = true;
        changeDescriptions.portuguese.push(
          `Execução Física alterada para ${phyExec}%`
        );
        changeDescriptions.english.push(
          `Physical Execution changed to ${phyExec}%`
        );
      }
    }

    updates.financialExecution = newFinancialExecution;
    updates.physicalExecution = newPhysicalExecution;

    if (
      req.body.fileName &&
      typeof req.body.fileName === "string" &&
      req.body.fileName.trim() !== "" &&
      existingDocument.fileName !== req.body.fileName.trim()
    ) {
      updates.fileName = req.body.fileName.trim();
      changesMade = true;
      changeDescriptions.portuguese.push(
        `Nome do arquivo alterado para "${updates.fileName}"`
      );
      changeDescriptions.english.push(
        `Filename changed to "${updates.fileName}"`
      );
    }
    if (
      req.body.reference &&
      typeof req.body.reference === "string" &&
      existingDocument.reference !== req.body.reference
    ) {
      updates.reference = req.body.reference;
      changesMade = true;
      changeDescriptions.portuguese.push(
        `Referência alterada para "${updates.reference}"`
      );
      changeDescriptions.english.push(
        `Reference changed to "${updates.reference}"`
      );
    }

    if (changesMade) {
      updates.uploadedAt = new Date(); // Consider if 'updatedAt' is more appropriate
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(200).json({
        message: "No substantive changes detected. Document not updated.",
        document: existingDocument,
      });
    }

    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true, session }
    );

    if (!updatedFinanceDocument) {
      await session.abortTransaction();
      session.endSession();
      // throw new ApiError(500, "Failed to update document after finding it."); // Assuming ApiError is defined elsewhere
      throw new Error("Failed to update document after finding it.");
    }

    const project = await editProject
      .findOne({ projectName: existingDocument.projName })
      .populate(
        "projectOwners.ownerId",
        "_id email userName notificationToken fcmDeviceToken"
      )
      .populate(
        "members",
        "_id email userName notificationToken fcmDeviceToken"
      )
      .session(session)
      .lean();

    if (!project) {
      console.warn(
        `Project "${existingDocument.projName}" not found for notifications during update.`
      );
      // Continue without project-specific details if necessary, or handle as error
    }

    // --- LOCALIZED NOTIFICATIONS ---
    const recipients = await getFinanceNotificationRecipients(
      project,
      performingUserId ? performingUserId.toString() : null
    );

    // 1. In-app Notifications
    const inAppNotifications = [];
    for (const recipient of recipients) {
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";
      const changesStringPt =
        changeDescriptions.portuguese.join(", ") || "detalhes atualizados";
      const changesStringEn =
        changeDescriptions.english.join(", ") || "details updated";

      const title = isPortuguese
        ? `Documento Financeiro Atualizado: ${updatedFinanceDocument.fileName}`
        : `Finance Document Updated: ${updatedFinanceDocument.fileName}`;
      const description = isPortuguese
        ? `O documento "${updatedFinanceDocument.fileName}" (${changesStringPt}) no projeto "${project?.projectName || existingDocument.projName}" foi atualizado por ${performingUserName}.`
        : `Document "${updatedFinanceDocument.fileName}" (${changesStringEn}) in project "${project?.projectName || existingDocument.projName}" was updated by ${performingUserName}.`;
      const lengthyDesc = isPortuguese
        ? `Informamos que o documento financeiro "${updatedFinanceDocument.fileName}" foi atualizado no projeto "${project?.projectName || existingDocument.projName}" por ${performingUserName}. Alterações: ${changesStringPt}. Acesse a plataforma para visualizar.//Atenciosamente,//Equipe Soapro`
        : `We would like to inform you that the finance document "${updatedFinanceDocument.fileName}" has been updated in project "${project?.projectName || existingDocument.projName}" by ${performingUserName}. Changes: ${changesStringEn}. Please access the platform to view.//Best regards,//Soapro Team`;

      inAppNotifications.push({
        title,
        type: "Document Update",
        description,
        lengthyDesc,
        memberId: recipient._id,
        projectId: project?._id,
      });
    }
    if (inAppNotifications.length > 0) {
      await ShowNotification.create(inAppNotifications, { session });
    }

    await session.commitTransaction();

    // 2. Push Notifications
    await sendLocalizedPushNotifications(
      recipients,
      {
        portuguese: "Documento Financeiro Atualizado",
        english: "Finance Document Updated",
      },
      {
        portuguese: `Doc "${updatedFinanceDocument.fileName}" (${changeDescriptions.portuguese.join(", ") || "atualizado"}) por ${performingUserName}.`,
        english: `Doc "${updatedFinanceDocument.fileName}" (${changeDescriptions.english.join(", ") || "updated"}) by ${performingUserName}.`,
      },
      {
        type: "Finance Document Updated",
        projectId: project?._id.toString() || "",
        documentId: updatedFinanceDocument._id.toString(),
        documentName: updatedFinanceDocument.fileName,
      }
    );

    // 3. Email Notifications
    for (const recipient of recipients) {
      if (!recipient.email) continue;
      const userLanguage = await getUserLanguage(recipient._id);
      const isPortuguese = userLanguage === "portuguese";
      const changesString = isPortuguese
        ? changeDescriptions.portuguese.join("; ") ||
          "detalhes foram atualizados"
        : changeDescriptions.english.join("; ") || "details were updated";

      const subject = isPortuguese
        ? `Documento Financeiro Atualizado: ${project?.projectName || existingDocument.projName}`
        : `Finance Document Updated: ${project?.projectName || existingDocument.projName}`;
      const html = isPortuguese
        ? `<html><body><p>Prezado(a) ${recipient.userName || "Usuário"},</p><p>O documento financeiro "<strong>${updatedFinanceDocument.fileName}</strong>" para o projeto "<strong>${project?.projectName || existingDocument.projName}</strong>" foi atualizado por ${performingUserName}.</p><p>Alterações: ${changesString}.</p><p>Acesse a plataforma para visualizar.</p><p>Atenciosamente,<br>Equipe Soapro</p></body></html>`
        : `<html><body><p>Dear ${recipient.userName || "User"},</p><p>The finance document "<strong>${updatedFinanceDocument.fileName}</strong>" for project "<strong>${project?.projectName || existingDocument.projName}</strong>" has been updated by ${performingUserName}.</p><p>Changes: ${changesString}.</p><p>Log in to view the updated document.</p><p>Best regards,<br>Soapro Team</p></body></html>`;

      try {
        await SendEmailUtil({
          from: process.env.EMAIL_USER,
          to: recipient.email,
          subject,
          html,
        });
      } catch (e) {
        console.error(`Email error to ${recipient.email}:`, e.message);
      }
    }
    // --- END LOCALIZED NOTIFICATIONS ---

    res.status(200).json({
      message: "Document updated, notifications sent.",
      document: updatedFinanceDocument,
    });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Error updating document:", error);
    res
      .status(error.statusCode || 500)
      .json({ message: error.message || "Error updating document" });
  } finally {
    session.endSession();
  }
};

export const deleteFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id;
  const performingUserName = req.user?.userName || "System";

  try {
    const financeDocument = await FinanceDocument.findById(
      req.params.id
    ).session(session);
    if (!financeDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const project = await editProject
      .findOne({ projectName: financeDocument.projName })
      .populate(
        "projectOwners.ownerId",
        "_id email userName notificationToken fcmDeviceToken"
      )
      .populate(
        "members",
        "_id email userName notificationToken fcmDeviceToken"
      )
      .session(session)
      .lean();

    if (financeDocument.fileUrl) {
      try {
        const urlParts = financeDocument.fileUrl.split("/");
        const fileKey = urlParts.slice(3).join("/");
        if (fileKey) await deleteFromS3(fileKey);
        else
          console.warn(
            `Could not extract file key from URL: ${financeDocument.fileUrl}`
          );
      } catch (s3Error) {
        console.error("Error deleting file from S3:", s3Error.message);
      }
    }

    await FinanceDocument.findByIdAndDelete(req.params.id, { session });

    // --- LOCALIZED NOTIFICATIONS ---
    const recipients = await getFinanceNotificationRecipients(
      project,
      performingUserId ? performingUserId.toString() : null
    );

    // 1. In-app Notifications
    const inAppNotifications = [];
    if (project) {
      // Only send if project context is clear
      for (const recipient of recipients) {
        const userLanguage = await getUserLanguage(recipient._id);
        const isPortuguese = userLanguage === "portuguese";

        const title = isPortuguese
          ? `Documento Financeiro Eliminado: ${financeDocument.fileName}`
          : `Finance Document Deleted: ${financeDocument.fileName}`;
        const description = isPortuguese
          ? `O documento "${financeDocument.fileName}" foi eliminado do projeto "${project.projectName}" por ${performingUserName}.`
          : `Document "${financeDocument.fileName}" was deleted from project "${project.projectName}" by ${performingUserName}.`;
        const lengthyDesc = isPortuguese
          ? `Informamos que o documento financeiro "${financeDocument.fileName}" foi eliminado do projeto "${project.projectName}" por ${performingUserName}.//Atenciosamente,//Equipe Soapro`
          : `We inform you that the finance document "${financeDocument.fileName}" has been deleted from project "${project.projectName}" by ${performingUserName}.//Best regards,//Soapro Team`;

        inAppNotifications.push({
          title,
          type: "Document Deletion",
          description,
          lengthyDesc,
          memberId: recipient._id,
          projectId: project._id,
        });
      }
      if (inAppNotifications.length > 0) {
        await ShowNotification.create(inAppNotifications, { session });
      }
    }

    await session.commitTransaction();

    // 2. Push Notifications
    if (project) {
      // Only send if project context is clear
      await sendLocalizedPushNotifications(
        recipients,
        {
          portuguese: "Documento Financeiro Eliminado",
          english: "Finance Document Deleted",
        },
        {
          portuguese: `Doc "${financeDocument.fileName}" do proj. "${project.projectName}" eliminado por ${performingUserName}.`,
          english: `Doc "${financeDocument.fileName}" from proj. "${project.projectName}" deleted by ${performingUserName}.`,
        },
        {
          type: "Finance Document Deleted",
          projectId: project._id.toString(),
          documentName: financeDocument.fileName,
          deletedDocumentId: financeDocument._id.toString(),
        }
      );
    }

    // 3. Email Notifications
    if (project) {
      // Only send if project context is clear
      for (const recipient of recipients) {
        if (!recipient.email) continue;
        const userLanguage = await getUserLanguage(recipient._id);
        const isPortuguese = userLanguage === "portuguese";

        const subject = isPortuguese
          ? `Documento Financeiro Eliminado do Projeto: ${project.projectName}`
          : `Finance Document Deleted from Project: ${project.projectName}`;
        const html = isPortuguese
          ? `<html><body><p>Prezado(a) ${recipient.userName || "Usuário"},</p><p>O documento financeiro "<strong>${financeDocument.fileName}</strong>" foi eliminado do projeto "<strong>${project.projectName}</strong>" por ${performingUserName}.</p><p>Atenciosamente,<br>Equipe Soapro</p></body></html>`
          : `<html><body><p>Dear ${recipient.userName || "User"},</p><p>The finance document "<strong>${financeDocument.fileName}</strong>" has been deleted from project "<strong>${project.projectName}</strong>" by ${performingUserName}.</p><p>Best regards,<br>Soapro Team</p></body></html>`;

        try {
          await SendEmailUtil({
            from: process.env.EMAIL_USER,
            to: recipient.email,
            subject,
            html,
          });
        } catch (e) {
          console.error(`Email error to ${recipient.email}:`, e.message);
        }
      }
    }
    // --- END LOCALIZED NOTIFICATIONS ---

    res
      .status(200)
      .json({ message: "Document deleted and notifications sent!" });
  } catch (error) {
    if (session.inTransaction()) await session.abortTransaction();
    console.error("Error deleting document:", error.message, error.stack);
    res
      .status(500)
      .json({ message: "Error deleting document", error: error.message });
  } finally {
    session.endSession();
  }
};
