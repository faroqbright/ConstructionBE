import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import mongoose from "mongoose";
// import  {SendEmailUtil} from "../utils/emailsender.js"
import {SendEmailUtil} from "../utils/emailsender.js"
<<<<<<< HEAD
import{User} from "../models/user.model.js";
=======
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82


const uploadFile = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Upload file to S3
    const fileUrl = await uploadToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!fileUrl) {
      return res.status(500).json({ message: "File upload failed" });
    }

<<<<<<< HEAD
    // Save document to MongoDB
=======
    // Create document entry
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
    const document = new Document({
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user,
      status: "pending",
    });

    await document.save({ session });

<<<<<<< HEAD
    // Notify project owners and members//
    if (req.body.projName) {
      const project = await editProject.findOne({ projectName: req.body.projName });

      if (project) {
        const notifiedEmails = new Set();

        // Notify owners
        for (const owner of project.projectOwners) {
          const ownerUser = await User.findById(owner.ownerId).select("email userName");
          if (ownerUser?.email) {
            const emailBody = {
              from: process.env.EMAIL_USER,
              to: ownerUser.email,
              subject: `New File Uploaded for Project: ${req.body.projName}`,
              text: `Hello ${ownerUser.userName},\n\nA new file named "${req.file.originalname}" has been uploaded for the project "${req.body.projName}".\n\nBest regards,\nYour Team`,
=======
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
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
            };

            try {
              await SendEmailUtil(emailBody);
<<<<<<< HEAD
              console.log(`Email sent to owner: ${ownerUser.email}`);
              notifiedEmails.add(ownerUser.email);
            } catch (error) {
              console.error("Error sending email to owner:", error.message);
            }
          }
        }

        // Notify members
        for (const memberId of project.members) {
          const memberUser = await User.findById(memberId).select("email userName");
          if (memberUser?.email && !notifiedEmails.has(memberUser.email)) {
            const emailBody = {
              from: process.env.EMAIL_USER,
              to: memberUser.email,
              subject: `New File Uploaded for Project: ${req.body.projName}`,
              text: `Hello ${memberUser.userName},\n\nA new file named "${req.file.originalname}" has been uploaded for the project "${req.body.projName}".\n\nBest regards,\nYour Team`,
            };

            try {
              await SendEmailUtil(emailBody);
              console.log(`Email sent to member: ${memberUser.email}`);
              notifiedEmails.add(memberUser.email);
            } catch (error) {
              console.error("Error sending email to member:", error.message);
            }
          }
        }

        if (notifiedEmails.size === 0) {
          console.warn("No valid emails found to notify.");
        }
      } else {
        console.warn("No project found with the provided project name.");
      }
    }

    res.status(201).json({
      message: "File uploaded successfully!",
      document,
    });
=======
            } catch (emailError) {
              console.error("Error sending email:", emailError);
            }
          }
        }
      }
    }

    await session.commitTransaction();
    res.status(201).json({ message: "File uploaded successfully!", document });
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error.message);
    res.status(500).json({ message: "Error uploading file", error: error.message });
  } finally {
    session.endSession();
  }
};

<<<<<<< HEAD


=======
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
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


<<<<<<< HEAD
=======

>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
const updateStatus = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const updates = req.body;
<<<<<<< HEAD

=======
    const { id } = req.params;
    const updates = req.body;

    const document = await Document.findById(id).session(session);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
    // Step 1: Update the document
    const updatedDocument = await Document.findByIdAndUpdate(id, updates, { new: true });

    if (!updatedDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

<<<<<<< HEAD
    // Step 2: Find the related project using projName
    const projectNameFromDocument = updatedDocument.projName;
    const relatedProject = await editProject.findOne({ projectName: projectNameFromDocument });
=======
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
    // Step 2: Find related project using projName
    const projectNameFromDocument = updatedDocument.projName;
    console.log("ddfdfdfd",projectNameFromDocument);

    const relatedProject = await editProject
      .findOne({ projectName: projectNameFromDocument })
      .populate("projectOwners.ownerId", "email ownerName") // populate owner emails
      .populate("members", "email userName"); // correctly populate member emails
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82

    if (!relatedProject) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

<<<<<<< HEAD
    // Step 3: Gather all user IDs (owners + members)
    const ownerIds = relatedProject.projectOwners.map(owner => owner.ownerId);
    const memberIds = relatedProject.members;

    // Merge and remove duplicates
    const allUserIds = [...new Set([...ownerIds, ...memberIds.map(id => id.toString())])];

    // Step 4: Fetch users from User model
    const users = await User.find({ _id: { $in: allUserIds } }).select("email userName");

    // Step 5: Send emails
    for (const user of users) {
      if (user?.email) {
        try {
          await SendEmailUtil({
            to: user.email,
            subject: "Document Status Updated",
            text: `Hello ${user.userName},\n\nThe status of document "${updatedDocument.fileName}" in project "${projectNameFromDocument}" has been updated to "${updatedDocument.status}".\n\nBest regards,\nYour Team`,
          });
          console.log(`✅ Email sent to: ${user.email}`);
        } catch (emailErr) {
          console.error(`❌ Failed to send email to ${user.email}:`, emailErr.message);
        }
      }
    }

    // Step 6: Send response
=======
    // Step 3: Collect owner and member emails
    const ownerEmails = relatedProject.projectOwners
      .map((owner) => owner.ownerId?.email)
      .filter(Boolean);
    
      console.log("owner",ownerEmails);

    const memberEmails = relatedProject.members
      .map((member) => member?.email)
      .filter(Boolean);
      
      console.log("member",memberEmails);
    

    const allEmails = [...new Set([...ownerEmails, ...memberEmails])]; // Unique emails

    // Step 4: Send emails
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

    // Step 5: Response
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
    res.status(200).json({
      message: "Document updated and notifications sent",
      document: updatedDocument,
    });

  } catch (error) {
<<<<<<< HEAD
=======
    await session.abortTransaction();
    res.status(500).json({ 
      message: "Error updating document", 
      error: error.message 
    });
  } finally {
    session.endSession();
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
    console.error("❌ Error in updateStatus:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
<<<<<<< HEAD
  }
};


const deleteDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Delete from AWS S3
    const fileKey = document.fileUrl.split('.com/')[1]; // Extract key from URL
    await deleteFromS3(fileKey);

    // Step 1: Fetch project related to this document
    const project = await editProject.findOne({ projectName: document.projName });

    if (!project) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

    // Step 2: Collect all user IDs (owners + members)
    const ownerIds = project.projectOwners.map(owner => owner.ownerId);
    const memberIds = project.members;

    const allUserIds = [...new Set([...ownerIds, ...memberIds.map(id => id.toString())])];

    // Step 3: Fetch user details
    const users = await User.find({ _id: { $in: allUserIds } }).select("email userName");

    // Step 4: Send notification emails
    for (const user of users) {
      if (user?.email) {
        try {
          await SendEmailUtil({
            to: user.email,
            subject: "Document Deleted",
            text: `Hello ${user.userName},\n\nThe document "${document.fileName}" related to the project "${document.projName}" has been deleted.\n\nBest regards,\nYour Team`,
          });
          console.log(`✅ Email sent to: ${user.email}`);
        } catch (emailErr) {
          console.error(`❌ Failed to send email to ${user.email}:`, emailErr.message);
        }
      }
    }

    // Step 5: Delete document from DB
    await Document.findByIdAndDelete(req.params.id);

    res.status(200).json({ message: "Document deleted successfully and notifications sent!" });

  } catch (error) {
    console.error("❌ Error in deleteDocument:", error);
    res.status(500).json({ message: "Error deleting document", error: error.message });
  }
};




export { uploadFile, getDocuments, updateStatus , deleteDocument };
=======
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
>>>>>>> 58727e08df3e4936850b3121270f9e9c09152f82
