import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js";
// import  {SendEmailUtil} from "../utils/emailsender.js"
import {SendEmailUtil} from "../utils/emailsender.js"
import{User} from "../models/user.model.js";


const uploadFile = async (req, res) => {
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

    // Save document to MongoDB
    const document = new Document({
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user,
      status: "pending",
    });

    await document.save();

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
            };

            try {
              await SendEmailUtil(emailBody);
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
  } catch (error) {
    console.error("Error uploading file:", error.message);
    res.status(500).json({ message: "Error uploading file", error: error.message });
  }
};



const getDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject.find({
      ...(!isMain
        ? { $or: [{ members: loggedInUserId }, { "projectOwners.ownerId": loggedInUserId }] }
        : {}),
    }).sort({ createdAt: -1 });  // Sort by the creation date in descending order

    if (assignedProjects.length === 0) {
      return res.status(200).json({ message: "No assigned projects found" });
    }

    const projectMap = assignedProjects.reduce((acc, proj) => {
      acc[proj.projectName] = proj.projectBanner;
      return acc;
    }, {});

    const documents = await Document.find({ projName: { $in: Object.keys(projectMap) } })
      .sort({ uploadedAt: -1 });  // Sort by uploadedAt in descending order

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
  try {
    const { id } = req.params;
    const updates = req.body;

    // Step 1: Update the document
    const updatedDocument = await Document.findByIdAndUpdate(id, updates, { new: true });

    if (!updatedDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    // Step 2: Find the related project using projName
    const projectNameFromDocument = updatedDocument.projName;
    const relatedProject = await editProject.findOne({ projectName: projectNameFromDocument });

    if (!relatedProject) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

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
    res.status(200).json({
      message: "Document updated and notifications sent",
      document: updatedDocument,
    });

  } catch (error) {
    console.error("❌ Error in updateStatus:", error);
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
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
