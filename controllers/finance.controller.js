import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
 

const uploadFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { projName, user, financialExecution, physicalExecution, fileName, reference } = req.body;

    if (!fileName) {
      return res.status(400).json({ message: "Filename is required" });
    }

    if (financialExecution < 0 || financialExecution > 100 || physicalExecution < 0 || physicalExecution > 100) {
      return res.status(400).json({ message: "Execution values must be between 0 and 100" });
    }

    const project = await editProject.findOne({ projectName: projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const finalFileName = fileName.includes(".") ? fileName : `${fileName}.${req.file.mimetype.split("/")[1]}`;

    // Notify only project owners
    for (const owner of project.projectOwners) {
      const user = owner.ownerId;
      if (user?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `New File Uploaded for Project: ${projName}`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <title>New File Notification</title>
            </head>
            <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <h2 style="color: #333;">New File Uploaded</h2>
                    <p style="font-size: 16px; color: #555;">Dear <strong>${user.userName}</strong>,</p>
                    <p style="font-size: 16px; color: #555;">A new file named <strong>"${finalFileName}"</strong> has been uploaded for the project <strong>"${projName}"</strong>.</p>
                    <p style="font-size: 16px; color: #555;">Please log in to your dashboard to view or download the file.</p>

                    <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions, feel free to contact our team.</p>
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
          console.log(`Email sent to ${user.email}`);
        } catch (error) {
          console.error("Error sending email:", error.message);
        }
      }
    }

    // Set local file URL or dummy URL (optional)
    const fileUrl = `/uploads/${finalFileName}`; // Modify based on how you store files locally

    // Save document
    const financeDocument = new FinanceDocument({
      projName,
      fileName: finalFileName,
      fileUrl,
      user,
      financialExecution,
      physicalExecution,
      reference,
      uploadedAt: new Date(),
    });

    await financeDocument.save({ session });

    // Create notifications (owners + members + uploader)
    const notificationRecipients = [
      ...project.members.map(m => m._id),
      ...project.projectOwners.map(o => o.ownerId?._id).filter(Boolean),
      req.user._id
    ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

    const notificationPromises = notificationRecipients.map(userId =>
      ShowNotification.create({
        title: "Finance Document Uploaded",
        type: "Document Upload",
        description: `New finance document "${finalFileName}" was uploaded for project "${projName}"`,
        memberId: userId,
        projectId: project._id,
      })
    );

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(201).json({
      message: "File uploaded successfully!",
      financeDocument
    });

  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error.message);
    res.status(500).json({
      message: "Error uploading file",
      error: error.message
    });
  } finally {
    session.endSession();
  }
};


const getFinanceDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject.find({
      ...(!isMain ? { $or: [
        { members: loggedInUserId }, 
        { "projectOwners.ownerId": loggedInUserId }
      ] } : {}),
    });

    const projectNames = assignedProjects.map((proj) => proj.projectName);

    if (projectNames.length === 0) {
      return res.status(200).json({ message: "No assigned projects found" });
    }

    const financeDocuments = await FinanceDocument.find({ projName: { $in: projectNames } })
      .sort({ uploadedAt: -1 });

    res.status(200).json(financeDocuments);
  } catch (error) {
    console.error("Error fetching finance documents:", error.message);
    res.status(500).json({ 
      message: "Failed to fetch finance documents", 
      error: error.message 
    });
  }
};


const updateFinanceDocument = async (req, res) => {
  try {
    const { id } = req.params;
    let updates = { uploadedAt: new Date() };

    const existingDocument = await FinanceDocument.findById(id);
    if (!existingDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (req.body.financialExecution !== undefined) {
      if (req.body.financialExecution < 0 || req.body.financialExecution > 100) {
        return res.status(400).json({ message: "Financial Execution must be between 0 and 100" });
      }
      updates.financialExecution = req.body.financialExecution;
    }

    if (req.body.physicalExecution !== undefined) {
      if (req.body.physicalExecution < 0 || req.body.physicalExecution > 100) {
        return res.status(400).json({ message: "Physical Execution must be between 0 and 100" });
      }
      updates.physicalExecution = req.body.physicalExecution;
    }

    if (req.body.fileName) {
      updates.fileName = req.body.fileName;
    }

    if (req.body.reference) {
      updates.reference = req.body.reference;
    }

    if (Object.keys(updates).length === 1) {
      return res.status(400).json({ message: "No changes detected" });
    }

    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(id, updates, { new: true });

    const project = await editProject.findOne({ projectName: existingDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName");

    if (!project) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

    // --- Send Notification ---
    const notificationData = {
      title: "Finance Document Updated",
      type: "Document Update",
      description: `Document "${updatedFinanceDocument.fileName || existingDocument.fileName}" for project "${project.projectName}" was updated.`,
      memberId: req.user._id, // assumes req.user is populated
      projectId: project._id,
    };

    try {
      await ShowNotification.create(notificationData);
      console.log("Notification created");
    } catch (err) {
      console.error("Error creating notification:", err.message);
    }

    // --- Send Emails ---
    const notify = async (user, role) => {
      const emailBody = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: `Finance Document Updated for Project: ${existingDocument.projName}`,
      
        text: `Hello ${user.userName || role},\n\nA finance document for the project "${existingDocument.projName}" has been updated.\n\nBest regards,\nYour Team`,
      
      };

      try {
        await SendEmailUtil(emailBody);
        console.log(`Email sent to ${role.toLowerCase()}: ${user.email}`);
      } catch (error) {
        console.error(`Error sending email to ${user.email}:`, error.message);
      }
    };

    for (const owner of project.projectOwners) {
      if (owner.ownerId?.email) {
        await notify(owner.ownerId, "Project Owner");
      }
    }

    for (const member of project.members) {
      if (member?.email) {
        await notify(member, "Project Member");
      }
    }

    res.status(200).json({
      message: "Document updated, notifications and emails sent",
      document: updatedFinanceDocument
    });

  } catch (error) {
    res.status(500).json({ message: "Error updating document", error: error.message });
  }
};


const deleteFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const financeDocument = await FinanceDocument.findById(req.params.id).session(session);
    if (!financeDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    const project = await editProject.findOne({ projectName: financeDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session);

    // Removed: await deleteFromS3(fileKey);

    await FinanceDocument.findByIdAndDelete(req.params.id, { session });

    const notificationRecipients = [
      ...(project?.members.map(m => m._id) || []),
      ...(project?.projectOwners.map(o => o.ownerId?._id).filter(Boolean) || []),
      req.user._id
    ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

    const notificationPromises = notificationRecipients.map(userId =>
      ShowNotification.create({
        title: "Finance Document Deleted",
        type: "Document Deletion",
        description: `Document "${financeDocument.fileName}" was deleted from project "${financeDocument.projName}"`,
        memberId: userId,
        projectId: project?._id,
      })
    );

    // Send emails to owners
    for (const owner of project.projectOwners) {
      if (owner.ownerId?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: owner.ownerId.email,
          subject: `Finance Document Deleted for Project: ${financeDocument.projName}`,
          html: `<p>Dear ${owner.ownerId.userName || "Owner"}, document deleted.</p>`
        };
        try {
          await SendEmailUtil(emailBody);
          console.log(`Email sent to owner: ${owner.ownerId.email}`);
        } catch (error) {
          console.error(`Error sending email to owner ${owner.ownerId.email}:`, error.message);
        }
      }
    }

    // Send emails to members
    for (const member of project.members) {
      if (member?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: member.email,
          subject: `Finance Document Deleted for Project: ${financeDocument.projName}`,
          html: `<p>Dear ${member.userName || "Member"}, document deleted.</p>`
        };
        try {
          await SendEmailUtil(emailBody);
          console.log(`Email sent to member: ${member.email}`);
        } catch (error) {
          console.error(`Error sending email to member ${member.email}:`, error.message);
        }
      }
    }

    await Promise.all(notificationPromises);
    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({ message: "Document deleted and notifications sent!" });

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ message: "Error deleting document", error: error.message });
  }
};


export {
  uploadFinanceDocument,
  getFinanceDocuments,
  updateFinanceDocument,
  deleteFinanceDocument,
};
