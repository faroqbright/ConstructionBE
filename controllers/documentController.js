import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import mongoose from "mongoose";
import { User } from "../models/user.model.js"; // Added import
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js"; // Added import

// Helper function to get recipients (user objects with tokens) and their IDs
const getDocumentNotificationRecipients = async (projectName, performingUserId) => {
    console.log(`[Document Notification] Getting recipients for project ${projectName}, performing user: ${performingUserId}`);

    const projectData = await editProject // Renamed to avoid conflict if 'project' is in outer scope
        .findOne({ projectName })
        .populate("members", "_id userName email notificationToken fcmDeviceToken")
        .populate("projectOwners.ownerId", "_id userName email notificationToken fcmDeviceToken");

    if (!projectData) {
        console.warn("[Document Notification] Project not found:", projectName);
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
            const token = ownerObj.ownerId.notificationToken || ownerObj.ownerId.fcmDeviceToken;
            recipientUserObjects.push({
                ...ownerObj.ownerId.toObject(),
                effectiveToken: token,
            });
            recipientUserObjectIds.add(ownerObj.ownerId._id.toString());
        }
    });

    if (performingUserId && !recipientUserObjectIds.has(performingUserId.toString())) {
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

    console.log(`[Document Notification] Total unique recipients: ${recipientUserObjectIds.size}`);
    return {
        recipients: recipientUserObjects,
        recipientIds: recipientUserObjectIds,
        project: projectData, // Return the populated project object
    };
};

// Helper function to send document push notifications
const sendDocumentPushNotifications = async (recipientsWithTokens, title, body, data) => {
    try {
        if (!recipientsWithTokens || recipientsWithTokens.length === 0) {
            console.warn("[Document Push] No recipients provided.");
            return;
        }
        console.log(`[Document Push] Preparing to send to ${recipientsWithTokens.length} potential users`);

        const fcmTokens = [
            ...new Set(
                recipientsWithTokens
                    .map((user) => user.effectiveToken)
                    .filter(Boolean)
            ),
        ];

        if (fcmTokens.length === 0) {
            console.warn("[Document Push] No valid FCM tokens found for any recipients");
            return;
        }

        console.log(`[Document Push] Sending to ${fcmTokens.length} unique devices`);
        const result = await sendPushNotification(fcmTokens, title, body, data);
        return result;

    } catch (error) {
        console.error("[Document Push] Error:", error);
    }
};

const uploadFile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  const performingUserId = req.user?._id; // Assuming req.user is populated by auth middleware
  const performingUserName = req.user?.userName || "a user";


  try {
    if (!req.file) {
      await session.abortTransaction(); session.endSession();
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload file to AWS S3
    const fileUrl = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!fileUrl) {
      await session.abortTransaction(); session.endSession();
      return res.status(500).json({ message: "File upload failed" });
    }

    // Create document entry
    const document = new Document({
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user, // User who is associated with the document content (e.g. author)
      status: "pending",
      // uploadedBy: performingUserId, // You might want to add this field to your Document model
    });

    await document.save({ session });

    if (req.body.projName) {
      const { recipients: usersForPush, recipientIds: userIdsForInApp, project } =
        await getDocumentNotificationRecipients(req.body.projName, performingUserId);

      if (project) { // Ensure project was found for notifications
        // Create In-App Notifications (Bulk)
        if (userIdsForInApp.size > 0) {
          const inAppNotificationObjects = Array.from(userIdsForInApp).map(userId => ({
            title: `New Document Available for "${req.body.projName}"`,
            type: "Document Upload",
            description: `A new document "${document.fileName}" has been uploaded to project "${req.body.projName}" by ${performingUserName}.`,
            lengthyDesc: `We would like to inform you that a new document "${document.fileName}" has been uploaded to the project "${req.body.projName}" by ${performingUserName}. To view or download the document, please access the project's section on the platform. Should you have any questions or require assistance, our team remains at your disposal.\nBest regards,\n[Soapro Team]`,
            memberId: userId,
            projectId: project._id,
          }));
          await ShowNotification.create(inAppNotificationObjects, { session });
        }

        // Send Push Notifications
        if (usersForPush.length > 0) {
          await sendDocumentPushNotifications(
            usersForPush,
            "New Document Uploaded",
            `Document "${document.fileName}" uploaded to project "${project.projectName}" by ${performingUserName}.`,
            {
              projectId: project._id.toString(),
              documentId: document._id.toString(),
              documentName: document.fileName,
              type: "DOCUMENT_UPLOAD",
            }
          );
        }

        // Send Emails to Project Owners (as per original logic)
        // usersForPush contains all relevant users (members and owners) with their emails if you want to expand.
        // The original code specifically targeted project.projectOwners for email.
        // We use the 'project' object returned by getDocumentNotificationRecipients which has owners populated.
        const emailPromises = project.projectOwners
            .filter(owner => owner.ownerId?.email) // owner.ownerId is the populated user object
            .map(owner => {
                const emailBody = {
                    from: process.env.EMAIL_USER,
                    to: owner.ownerId.email,
                    subject: `New File Uploaded for Project: ${project.projectName}`,
                    html: `
                        <!DOCTYPE html>
                        <html lang="en">
                        <head><meta charset="UTF-8"><title>New Document Notification</title></head>
                        <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                            <tr><td style="padding: 20px; text-align: center;">
                            <h2 style="color: #333;">New Document Available</h2>
                            <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.userName || 'Project Owner'}</strong>,</p>
                            <p style="font-size: 16px; color: #555;">A new document titled <strong>"${document.fileName}"</strong> has been uploaded to project <strong>"${project.projectName}"</strong> by ${performingUserName}.</p>
                            <p style="font-size: 16px; color: #555;">Click the button below to view the document:</p>
                            <a href="${process.env.DOCUMENT_BASE_URL}/${document.fileName}" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">View Document</a>
                            <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions or require assistance, our team is available to support you.</p>
                            <p style="font-size: 14px; color: #999;">Best regards,<br><strong>Your Team</strong></p>
                            </td></tr>
                        </table></body></html>
                    `,
                };
                return SendEmailUtil(emailBody).catch(e => console.error(`Email send error to ${owner.ownerId.email}:`, e));
            });
        await Promise.all(emailPromises);
      } else {
          console.warn(`[UploadFile] Project "${req.body.projName}" not found or no recipients, skipping notifications.`);
      }
    }
    // The second email block from the original code seems redundant if the above handles owner emails.
    // If it had a different purpose, it might need to be re-evaluated.
    // For now, assuming the above notification block is comprehensive for uploads.

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
      .select("projectName projectBanner") // Select only needed fields
      .sort({ createdAt: -1 })
      .lean(); // Use lean for read-only operations

    // If not main user and no projects, return empty array directly
    // The original code returned { message: "No assigned projects found" } which is not an array.
    // Returning an empty array is more standard for list endpoints.
    if (!isMain && assignedProjects.length === 0) {
      return res.status(200).json([]);
    }

    const projectMap = assignedProjects.reduce((acc, proj) => {
      acc[proj.projectName] = proj.projectBanner;
      return acc;
    }, {});

    const documentQueryCriteria = isMain ? {} : { projName: { $in: Object.keys(projectMap) } };
    
    const documents = await Document.find(documentQueryCriteria)
        .sort({ uploadedAt: -1 }) // Assuming 'uploadedAt' exists in your Document model, or use 'createdAt'
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
    const updates = req.body; // e.g., { status: "approved" }

    // Validate status if it's being updated (example from first snippet)
    if (updates.status && !["pending", "approved", "rejected", "archived", "review"].includes(updates.status)) { // Added "review" as an example, adjust to your actual statuses
        await session.abortTransaction(); session.endSession();
        return res.status(400).json({ message: "Invalid status value." });
    }

    const existingDocument = await Document.findById(id).session(session);
    if (!existingDocument) {
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    // Add who performed the update and when (fields from first snippet, ensure they exist in your model or add them)
    // updates.lastUpdatedBy = performingUserId;
    // updates.updatedAt = new Date(); // Your model might have timestamps: true for this

    const updatedDocument = await Document.findByIdAndUpdate(id, { $set: updates }, {
      new: true,
      runValidators: true, // Good practice
      session,
    });

    if (!updatedDocument) { // Should not happen if existingDocument was found
        await session.abortTransaction(); session.endSession();
        return res.status(404).json({ message: "Document update failed unexpectedly." });
    }

    if (updatedDocument.projName) {
        const { recipients: usersForPush, recipientIds: userIdsForInApp, project } = 
            await getDocumentNotificationRecipients(updatedDocument.projName, performingUserId);

        if (project) { 
            // Create In-App Notifications
            if (userIdsForInApp.size > 0) {
                const inAppNotificationObjects = Array.from(userIdsForInApp).map(userId => ({
                    title: `Document Status Updated for "${project.projectName}"`,
                    type: "Document Update",
                    description: `Document "${updatedDocument.fileName}" status changed to "${updatedDocument.status}" by ${performingUserName}.`,
                    lengthyDesc: `The status of document "${updatedDocument.fileName}" in project "${project.projectName}" has been updated to "${updatedDocument.status}" by ${performingUserName}. Please review the changes as needed.\nBest regards,\n[Soapro Team]`,
                    memberId: userId,
                    projectId: project._id,
                }));
                await ShowNotification.create(inAppNotificationObjects, { session });
            }

            // Send Push Notifications
            if (usersForPush.length > 0) {
                await sendDocumentPushNotifications(
                    usersForPush,
                    "Document Status Updated",
                    `Doc "${updatedDocument.fileName}" in "${project.projectName}" status: ${updatedDocument.status}. By ${performingUserName}.`,
                    {
                        projectId: project._id.toString(),
                        documentId: updatedDocument._id.toString(),
                        documentName: updatedDocument.fileName,
                        newStatus: updatedDocument.status,
                        type: "DOCUMENT_STATUS_UPDATE",
                    }
                );
            }
            
            // Send Emails to all relevant users (members and owners)
            const allRelevantUsersForEmail = usersForPush.filter(u => u.email);
            const emailPromises = allRelevantUsersForEmail.map(user => {
                const emailBody = {
                    from: process.env.EMAIL_USER,
                    to: user.email,
                    subject: `Document Status Updated: ${updatedDocument.fileName}`,
                    html: `Dear <strong>${user.userName || 'User'}</strong>,<br><br>The status of document <strong>"${updatedDocument.fileName}"</strong> in project <strong>"${project.projectName}"</strong> has been updated to <strong>"${updatedDocument.status}"</strong> by ${performingUserName}.<br><br>Regards,<br>The Soapro Team`,
                    // Using a simpler text version based on original second snippet's email for update.
                    // text: `The status of document "${updatedDocument.fileName}" in project "${project.projectName}" has been updated to "${updatedDocument.status}" by ${performingUserName}.`,
                };
                return SendEmailUtil(emailBody).catch(e => console.error(`Email send error to ${user.email}:`, e.message));
            });
            await Promise.all(emailPromises);
        } else {
            console.warn(`[UpdateStatus] Project "${updatedDocument.projName}" not found, skipping notifications.`);
        }
    }

    await session.commitTransaction();
    res.status(200).json({
      message: "Document updated successfully",
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
      await session.abortTransaction(); session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const { projName, fileName, _id: documentId, fileUrl } = document;

    // Delete from AWS S3
    if (fileUrl) { // Ensure fileUrl exists before trying to split
        const fileKey = fileUrl.split(".com/")[1];
        if (fileKey) { // Ensure split was successful
            await deleteFromS3(fileKey);
        } else {
            console.warn(`[DeleteDocument] Could not parse fileKey from S3 URL: ${fileUrl}`);
        }
    }


    // Delete from MongoDB
    await Document.findByIdAndDelete(req.params.id, { session });

    if (projName) {
        const { recipients: usersForPush, recipientIds: userIdsForInApp, project } = 
            await getDocumentNotificationRecipients(projName, performingUserId);
        
        if (project) { 
            // Create In-App Notifications
            if (userIdsForInApp.size > 0) {
                const inAppNotificationObjects = Array.from(userIdsForInApp).map(userId => ({
                    title: `Document Deleted from "${project.projectName}"`,
                    type: "Document Deletion",
                    description: `Document "${fileName}" was deleted from project "${project.projectName}" by ${performingUserName}.`,
                    lengthyDesc: `The document "${fileName}" has been deleted from project "${project.projectName}" by ${performingUserName}.\nIf this was unexpected, please contact support.\nBest regards,\n[Soapro Team]`,
                    memberId: userId,
                    projectId: project._id,
                }));
                await ShowNotification.create(inAppNotificationObjects, { session });
            }

            // Send Push Notifications
            if (usersForPush.length > 0) {
                await sendDocumentPushNotifications(
                    usersForPush,
                    "Document Deleted",
                    `Doc "${fileName}" deleted from project "${project.projectName}" by ${performingUserName}.`,
                    {
                        projectId: project._id.toString(),
                        documentId: documentId.toString(), 
                        documentName: fileName,
                        type: "DOCUMENT_DELETED",
                    }
                );
            }

            // Send Emails for deletion (consistent with first snippet's behavior)
            const allRelevantUsersForEmail = usersForPush.filter(u => u.email);
            const emailPromises = allRelevantUsersForEmail.map(user => {
                const emailBody = {
                    from: process.env.EMAIL_USER,
                    to: user.email,
                    subject: `Document Deleted: ${fileName}`,
                    html: `Dear <strong>${user.userName || 'User'}</strong>,<br><br>The document <strong>"${fileName}"</strong> in project <strong>"${project.projectName}"</strong> has been deleted by ${performingUserName}.<br><br>Regards,<br>The Soapro Team`,
                };
                return SendEmailUtil(emailBody).catch(e => console.error(`Email send error to ${user.email}:`, e.message));
            });
            await Promise.all(emailPromises);
        } else {
            console.warn(`[DeleteDocument] Project "${projName}" not found, skipping notifications.`);
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