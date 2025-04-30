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
              text: `Hello ${owner.ownerId.ownerName},\n\nA new file named "${req.file.originalname}" has been uploaded${req.body.projName ? ` for the project "${req.body.projName}"` : ''}.\n\nBest regards,\nYour Team`,
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
      return res.status(404).json({ message: "Document not found" });
    }

    const updatedDocument = await Document.findByIdAndUpdate(
      id, 
      updates, 
      { new: true, session }
    );

    // Create notification for status update
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
        title: "Document Status Updated",
        type: "Document Update",
        description: `Document "${document.fileName}" status changed to "${updates.status}"`,
        memberId: userId,
        projectId: project?._id,
      })
    );

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(200).json({ 
      message: "Document updated successfully", 
      document: updatedDocument 
    });
  } catch (error) {
    await session.abortTransaction();
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