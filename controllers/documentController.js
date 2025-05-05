import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import mongoose from "mongoose";

const uploadFile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload file to AWS S3
    const fileUrl = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!fileUrl) {
      return res.status(500).json({ message: "File upload failed" });
    }

    // Create document entry
    const document = new Document({
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user,
      status: "pending",
    });

    await document.save({ session });

    let project;
    if (req.body.projName) {
      project = await editProject.findOne({ projectName: req.body.projName })
        .populate("projectOwners.ownerId", "email ownerName")
        .populate("members", "email userName")
        .session(session);

      if (project) {
        // Create notifications for all relevant users
        const notificationRecipients = [
          ...project.members.map(m => m._id),
          ...project.projectOwners.map(o => o.ownerId?._id).filter(Boolean),
          req.user._id
        ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

        const notificationPromises = notificationRecipients.map(userId => 
          ShowNotification.create({
            title: "Document Uploaded",
            type: "Document Upload",
            description: `New document "${req.file.originalname}" was uploaded${req.body.projName ? ` for project "${req.body.projName}"` : ''}`,
            memberId: userId,
            projectId: project?._id,
          })
        );

        await Promise.all(notificationPromises);

        // Send emails to project owners
        for (const owner of project.projectOwners) {
          if (owner.ownerId?.email) {
            const emailBody = {
              from: process.env.EMAIL_USER,
              to: owner.ownerId.email,
              subject: `New File Uploaded${req.body.projName ? ` for Project: ${req.body.projName}` : ''}`,
              html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <title>New Document Notification</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                    <tr>
                      <td style="padding: 20px; text-align: center;">
                        <h2 style="color: #333;">New Document Available</h2>
                        <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.ownerName}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">A new document titled <strong>"${req.file.originalname}"</strong> has been uploaded${req.body.projName ? ` to the project <strong>"${req.body.projName}"</strong>` : ''}.</p>
                        <p style="font-size: 16px; color: #555;">Click the button below to view the document:</p>
          
                        <a href="${process.env.DOCUMENT_BASE_URL}/${req.file.filename}" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">
                          View Document
                        </a>
          
                        <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions or require assistance, our team is available to support you.</p>
                        <p style="font-size: 14px; color: #999;">Best regards,<br><strong>Your Team</strong></p>
                      </td>
                    </tr>
                  </table>
                </body>
                </html>
              `,
            };          

            try {
              await SendEmailUtil(emailBody);
            } catch (emailError) {
              console.error("Error sending email:", emailError);
            }
          }
        }
      }
    }
    if (req.body.projName) {
      const projectExists = await editProject.findOne({ projectName: req.body.projName }).populate("projectOwners.ownerId", "email ownerName");

      if (projectExists && projectExists.projectOwners.length > 0) {
        for (const owner of projectExists.projectOwners) {
          if (owner.ownerId?.email) {
            const emailBody = {
              from: process.env.EMAIL_USER,
              to: owner.ownerId.email,
              subject: `New File Uploaded for Project: ${req.body.projName}`,
              html: `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <title>New Document Notification</title>
                </head>
                <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                    <tr>
                      <td style="padding: 20px; text-align: center;">
                        <h2 style="color: #333;">New Document Available</h2>
                        <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.ownerName}</strong>,</p>
                        <p style="font-size: 16px; color: #555;">A new document titled <strong>"${req.file.originalname}"</strong> has been uploaded for the project <strong>"${req.body.projName}"</strong>.</p>
                        <p style="font-size: 16px; color: #555;">Click the button below to view the document:</p>
            
                        <a href="${process.env.DOCUMENT_BASE_URL}/${req.file.filename}" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #007bff; color: #ffffff; text-decoration: none; border-radius: 5px; font-weight: bold;">
                          View Document
                        </a>
            
                        <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions or require assistance, our team is available to support you.</p>
                        <p style="font-size: 14px; color: #999;">Best regards,<br><strong>Your Team</strong></p>
                      </td>
                    </tr>
                  </table>
                </body>
                </html>
              `,
            };            

            try {
              await SendEmailUtil(emailBody);
              console.log(`Email sent to ${owner.ownerId.email}`);
            } catch (error) {
              console.error("Error sending email:", error.message);
            }
          }
        }
      } else {
        console.warn("No project owners found for the provided project name.");
      }
    }

    await session.commitTransaction();
    res.status(201).json({ message: "File uploaded successfully!", document });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error.message);
    res.status(500).json({ message: "Error uploading file", error: error.message });
  } finally {
    session.endSession();
  }
};

const getDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject.find({
      ...(!isMain
        ? { $or: [{ members: loggedInUserId }, { "projectOwners.ownerId": loggedInUserId }] }
        : {}),
    }).sort({ createdAt: -1 });

    if (assignedProjects.length === 0) {
      return res.status(200).json({ message: "No assigned projects found" });
    }

    const projectMap = assignedProjects.reduce((acc, proj) => {
      acc[proj.projectName] = proj.projectBanner;
      return acc;
    }, {});

    const documents = await Document.find({ projName: { $in: Object.keys(projectMap) } })
      .sort({ uploadedAt: -1 });

    const documentsWithBanner = documents.map((doc) => ({
      ...doc.toObject(),
      projectBanner: projectMap[doc.projName] || [],
    }));

    res.status(200).json(documentsWithBanner);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch documents", error: error.message });
  }
};

const updateStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;

    const document = await Document.findById(id).session(session);
    if (!document) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Document not found" });
    }

    const updatedDocument = await Document.findByIdAndUpdate(
      id,
      updates,
      { new: true, session }
    );

    // Step 1: Get related project if it exists
    let project;
    if (document.projName) {
      project = await editProject.findOne({ projectName: document.projName })
        .populate("projectOwners.ownerId", "email ownerName")
        .populate("members", "email userName")
        .session(session);
    }

    // Step 2: Prepare notifications
    const notificationRecipients = [
      ...(project?.members.map(m => m._id) || []),
      ...(project?.projectOwners.map(o => o.ownerId?._id).filter(Boolean) || []),
      req.user._id
    ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

    const notificationPromises = notificationRecipients.map(userId =>
      ShowNotification.create({
        title: "Document Status Updated",
        type: "Document Update",
        description: `Document "${document.fileName}" status changed to "${updates.status}"`,
        memberId: userId,
        projectId: project?._id,
      })
    );

    // Step 3: Get email recipients
    const projectNameFromDocument = updatedDocument.projName;
    const relatedProject = await editProject
      .findOne({ projectName: projectNameFromDocument })
      .populate("projectOwners.ownerId", "email ownerName")
      .populate("members", "email userName");

    if (!relatedProject) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Project not found for this document" });
    }

    const ownerEmails = relatedProject.projectOwners
      .map(owner => owner.ownerId?.email)
      .filter(Boolean);

    const memberEmails = relatedProject.members
      .map(member => member?.email)
      .filter(Boolean);

    const allEmails = [...new Set([...ownerEmails, ...memberEmails])];

    // Step 4: Send Emails
    for (const email of allEmails) {
      try {
        await SendEmailUtil({
          to: email,
          subject: "Document Status Updated",
          text: `The status of document "${updatedDocument.fileName}" in project "${projectNameFromDocument}" has been updated to "${updatedDocument.status}".`,
        });
        console.log(`✅ Email sent to: ${email}`);
      } catch (emailErr) {
        console.error(`❌ Failed to send email to ${email}:`, emailErr.message);
      }
    }

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(200).json({
      message: "Document updated successfully",
      document: updatedDocument
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("@ Error in updateStatus:", error);
    res.status(500).json({
      message: "Error updating document",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};


const deleteDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const document = await Document.findById(req.params.id).session(session);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Delete from AWS S3
    const fileKey = document.fileUrl.split('.com/')[1];
    await deleteFromS3(fileKey);

    // Delete from MongoDB
    await Document.findByIdAndDelete(req.params.id, { session });

    // Create notification for deletion
    let project;
    if (document.projName) {
      project = await editProject.findOne({ projectName: document.projName })
        .populate("projectOwners.ownerId", "email ownerName")
        .populate("members", "email userName")
        .session(session);
    }

    const notificationRecipients = [
      ...(project?.members.map(m => m._id) || []),
      ...(project?.projectOwners.map(o => o.ownerId?._id).filter(Boolean) || []),
      req.user._id
    ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

    const notificationPromises = notificationRecipients.map(userId =>
      ShowNotification.create({
        title: "Document Deleted",
        type: "Document Deletion",
        description: `Document "${document.fileName}" was deleted${document.projName ? ` from project "${document.projName}"` : ''}`,
        memberId: userId,
        projectId: project?._id,
      })
    );

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(200).json({ message: "Document deleted successfully!" });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({ 
      message: "Error deleting document", 
      error: error.message 
    });
  } finally {
    session.endSession();
  }
};

export { uploadFile, getDocuments, updateStatus, deleteDocument };