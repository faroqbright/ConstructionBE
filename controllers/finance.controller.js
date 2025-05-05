import mongoose from "mongoose";
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";

// const uploadFinanceDocument = async (req, res) => {
//   try {
//     if (!req.file) {
//         return res.status(400).json({ message: "No file uploaded" });
//     }

//     const { projName, user, financialExecution, physicalExecution, fileName, reference } = req.body;

//     if (!fileName) {
//       return res.status(400).json({ message: "Filename is required" });
//     }

//     if (financialExecution < 0 || financialExecution > 100 || physicalExecution < 0 || physicalExecution > 100) {
//       return res.status(400).json({ message: "Execution values must be between 0 and 100" });
//     }

//     const projectExists = await editProject.findOne({ projectName: projName });
//     if (!projectExists) {
//       return res.status(404).json({ message: "Project not found" });
//     }

//     const finalFileName = fileName.includes(".") ? fileName : `${fileName}.${req.file.mimetype.split("/")[1]}`;

//     const fileUrl = await uploadToS3(req.file.buffer, finalFileName, req.file.mimetype);
//     if (!fileUrl) {
//       return res.status(500).json({ message: "File upload failed" });
//     }

//     const financeDocument = new FinanceDocument({
//       projName,
//       fileName: finalFileName,
//       fileUrl,
//       user,
//       financialExecution,
//       physicalExecution,
//       reference,
//       uploadedAt: new Date(), // ✅ Ensure timestamp is stored
//     });

//     await financeDocument.save();
//     res.status(201).json({ message: "File uploaded successfully!", financeDocument });
//   } catch (error) {
//     res.status(500).json({ message: "Error uploading file", error: error.message });
//   }
// };

const uploadFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (!req.file) {
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

    if (!fileName) {
      return res.status(400).json({ message: "Filename is required" });
    }

    if (
      financialExecution < 0 ||
      financialExecution > 100 ||
      physicalExecution < 0 ||
      physicalExecution > 100
    ) {
      return res
        .status(400)
        .json({ message: "Execution values must be between 0 and 100" });
    }

    const project = await editProject
      .findOne({ projectName: projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session);

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const projectExists = await editProject.findOne({ projectName: projName });
    const projectOwners = projectExists.projectOwners;
    if (projectOwners.length === 0) {
      return res.status(404).json({ message: "No project owners found" });
    }

    // Prepare email body for each owner
    for (const owner of projectOwners) {
      if (owner.ownerId?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: owner.ownerId.email,
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
                    <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.userName}</strong>,</p>
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

        // Send the email
        try {
          await SendEmailUtil(emailBody);
          console.log(`Email sent to ${owner.ownerId.email}`);
        } catch (error) {
          console.error("Error sending email:", error.message);
        }
      }
    }

    const finalFileName = fileName.includes(".")
      ? fileName
      : `${fileName}.${req.file.mimetype.split("/")[1]}`;

    const fileUrl = await uploadToS3(
      req.file.buffer,
      finalFileName,
      req.file.mimetype
    );
    if (!fileUrl) {
      return res.status(500).json({ message: "File upload failed" });
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
    });

    await financeDocument.save({ session });

    // Notification recipients (owners + members + performing user)
    const notificationRecipients = [
      ...project.members.map((m) => m._id),
      ...project.projectOwners.map((o) => o.ownerId?._id).filter(Boolean),
      req.user._id,
    ].filter(
      (v, i, a) => a.findIndex((t) => t.toString() === v.toString()) === i
    );

    // Create notifications
    const notificationPromises = notificationRecipients.map((userId) =>
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
      financeDocument,
    });
  } catch (error) {
    await session.abortTransaction();
    console.error("Error uploading file:", error.message);
    res.status(500).json({
      message: "Error uploading file",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const getFinanceDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject.find({
      ...(!isMain
        ? {
            $or: [
              { members: loggedInUserId },
              { "projectOwners.ownerId": loggedInUserId },
            ],
          }
        : {}),
    });

    const projectNames = assignedProjects.map((proj) => proj.projectName);

    if (projectNames.length === 0) {
      return res.status(200).json({ message: "No assigned projects found" });
    }

    const financeDocuments = await FinanceDocument.find({
      projName: { $in: projectNames },
    }).sort({ uploadedAt: -1 });

    res.status(200).json(financeDocuments);
  } catch (error) {
    console.error("Error fetching finance documents:", error.message);
    res.status(500).json({
      message: "Failed to fetch finance documents",
      error: error.message,
    });
  }
};

// const updateFinanceDocument = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const { id } = req.params;
//     let updates = {};
//     let notify = false;
//     let executionChanges = []; // Track which execution values changed

//     // Fetch the existing document
//     const existingDocument = await FinanceDocument.findById(id).session(session);
//     if (!existingDocument) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({ message: "Document not found" });
//     }

//     // Check for financial execution change
//     if (req.body.financialExecution !== undefined && req.body.financialExecution !== null) {
//       const financialExec = parseFloat(req.body.financialExecution);
//       if (!isNaN(financialExec))    {
//         if (financialExec !== existingDocument.financialExecution) {
//           updates.financialExecution = financialExec;
//           executionChanges.push(`Financial execution changed from ${existingDocument.financialExecution}% to ${financialExec}%`);
//           notify = true;
//         }
//       }
//     }

//     // Check for physical execution change
//     if (req.body.physicalExecution !== undefined && req.body.physicalExecution !== null) {
//       const physicalExec = parseFloat(req.body.physicalExecution);
//       if (!isNaN(physicalExec)) {
//         if (physicalExec !== existingDocument.physicalExecution) {
//           updates.physicalExecution = physicalExec;
//           executionChanges.push(`Physical execution changed from ${existingDocument.physicalExecution}% to ${physicalExec}%`);
//           notify = true;
//         }
//       }
//     }

//     // Handle other fields
//     if (req.body.reference !== undefined) {
//       updates.reference = req.body.reference;
//       notify = true;
//     }

//     if (req.body.fileName !== undefined) {
//       updates.fileName = req.body.fileName;
//       notify = true;
//     }

//     if (!notify) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(400).json({ message: "No changes detected" });
//     }

//     // Add update timestamp
//     updates.updatedAt = new Date();

//     // Perform the update
//     const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
//       id,
//       updates,
//       { new: true, runValidators: true, session }
//     );

//     if (!updatedFinanceDocument) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({ message: "Document not found during update" });
//     }

//     // Get project details for notifications
//     const project = await editProject.findOne({ projectName: existingDocument.projName })
//       .populate("projectOwners.ownerId", "email userName")
//       .populate("members", "email userName")
//       .session(session);

//     if (!project) {
//       await session.abortTransaction();
//       session.endSession();
//       return res.status(404).json({ message: "Project not found for this document" });
//     }

//     // Prepare notification description with execution changes
//     let notificationDescription = `Document "${updatedFinanceDocument.fileName}" in project "${project.projectName}" was updated.`;

//     if (executionChanges.length > 0) {
//       notificationDescription += ` Changes: ${executionChanges.join(', ')}`;
//     }

//     // Prepare notifications for all relevant users
//     const notificationRecipients = [
//       ...(project.members.map(m => m._id) || []),
//       ...(project.projectOwners.map(o => o.ownerId?._id).filter(Boolean) || []),
//       req.user._id
//     ].filter(
//       (v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i
//     );

//     // Create notifications in bulk
//     const notificationPromises = notificationRecipients.map(userId =>
//       ShowNotification.create([{
//         title: "Finance Document Updated",
//         type: "Document Update",
//         description: notificationDescription,
//         memberId: userId,
//         projectId: project._id,
//         documentId: updatedFinanceDocument._id
//       }], { session })
//     );

//     await Promise.all(notificationPromises);
//     await session.commitTransaction();

//     res.status(200).json({
//       message: "Document updated successfully",
//       document: updatedFinanceDocument
//     });

//   } catch (error) {
//     console.error("Error updating finance document:", error);
//     await session.abortTransaction();
//     res.status(500).json({
//       message: "Error updating document",
//       error: error.message
//     });
//   } finally {
//     session.endSession();
//   }
// };

const updateFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    let updates = {};
    let notify = false;
    let executionChanges = []; // Track which execution values changed

    // Fetch the existing document
    const existingDocument =
      await FinanceDocument.findById(id).session(session);
    if (!existingDocument) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Document not found" });
    }

    // Handle financial execution change (only if specifically provided)
    if ("financialExecution" in req.body) {
      const financialExec = parseFloat(req.body.financialExecution);
      if (!isNaN(financialExec)) {
        if (financialExec !== existingDocument.financialExecution) {
          updates.financialExecution = financialExec;
          executionChanges.push(
            `Financial execution changed from ${existingDocument.financialExecution}% to ${financialExec}%`
          );
          notify = true;
        }
      } else if (req.body.financialExecution === null) {
        // Handle null case if needed
        updates.financialExecution = null;
        executionChanges.push(
          `Financial execution removed (was ${existingDocument.financialExecution}%)`
        );
        notify = true;
      }
    }

    // Handle physical execution change (only if specifically provided)
    if ("physicalExecution" in req.body) {
      const physicalExec = parseFloat(req.body.physicalExecution);
      if (!isNaN(physicalExec)) {
        if (physicalExec !== existingDocument.physicalExecution) {
          updates.physicalExecution = physicalExec;
          executionChanges.push(
            `Physical execution changed from ${existingDocument.physicalExecution}% to ${physicalExec}%`
          );
          notify = true;
        }
      } else if (req.body.physicalExecution === null) {
        // Handle null case if needed
        updates.physicalExecution = null;
        executionChanges.push(
          `Physical execution removed (was ${existingDocument.physicalExecution}%)`
        );
        notify = true;
      }
    }

    // Handle other fields (reference and fileName)
    if (req.body.reference !== undefined) {
      updates.reference = req.body.reference;
      notify = true;
    }

    if (req.body.fileName !== undefined) {
      updates.fileName = req.body.fileName;
      notify = true;
    }

    if (!notify) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ message: "No changes detected" });
    }

    // Add update timestamp
    updates.updatedAt = new Date();

    // Perform the update
    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true, session }
    );

    if (!updatedFinanceDocument) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ message: "Document not found during update" });
    }

    // Get project details for notifications
    const project = await editProject
      .findOne({ projectName: existingDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session);

    if (!project) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(404)
        .json({ message: "Project not found for this document" });
    }

    // Prepare notification description with execution changes
    let notificationDescription = `Document "${updatedFinanceDocument.fileName}" in project "${project.projectName}" was updated.`;

    if (executionChanges.length > 0) {
      notificationDescription += ` Changes: ${executionChanges.join(", ")}`;
    }

    // Prepare notifications for all relevant users
    const notificationRecipients = [
      ...(project.members.map((m) => m._id) || []),
      ...(project.projectOwners.map((o) => o.ownerId?._id).filter(Boolean) ||
        []),
      req.user._id,
    ].filter(
      (v, i, a) => a.findIndex((t) => t.toString() === v.toString()) === i
    );

    // Create notifications in bulk
    const notificationPromises = notificationRecipients.map((userId) =>
      ShowNotification.create(
        [
          {
            title: "Finance Document Updated",
            type: "Document Update",
            description: notificationDescription,
            memberId: userId,
            projectId: project._id,
            documentId: updatedFinanceDocument._id,
          },
        ],
        { session }
      )
    );

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(200).json({
      message: "Document updated successfully",
      document: updatedFinanceDocument,
    });
  } catch (error) {
    console.error("Error updating finance document:", error);
    await session.abortTransaction();
    res.status(500).json({
      message: "Error updating document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

const deleteFinanceDocument = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const financeDocument = await FinanceDocument.findById(
      req.params.id
    ).session(session);
    if (!financeDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    const project = await editProject
      .findOne({ projectName: financeDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName")
      .session(session);

    // Delete file from S3
    const fileKey = financeDocument.fileUrl.split(".com/")[1];
    await deleteFromS3(fileKey);

    // Delete document
    await FinanceDocument.findByIdAndDelete(req.params.id, { session });

    // Create deletion notification
    const notificationRecipients = [
      ...(project?.members.map((m) => m._id) || []),
      ...(project?.projectOwners.map((o) => o.ownerId?._id).filter(Boolean) ||
        []),
      req.user._id,
    ].filter(
      (v, i, a) => a.findIndex((t) => t.toString() === v.toString()) === i
    );

    const notificationPromises = notificationRecipients.map((userId) =>
      ShowNotification.create({
        title: "Finance Document Deleted",
        type: "Document Deletion",
        description: `Document "${financeDocument.fileName}" was deleted from project "${financeDocument.projName}"`,
        memberId: userId,
        projectId: project?._id,
      })
    );

    for (const owner of project.projectOwners) {
      if (owner.ownerId?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: owner.ownerId.email,
          subject: `Finance Document Deleted for Project: ${financeDocument.projName}`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <title>Finance Document Deleted</title>
            </head>
            <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <h2 style="color: #d9534f;">Finance Document Deleted</h2>
                    <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.userName || "Project Owner"}</strong>,</p>
                    <p style="font-size: 16px; color: #555;">A finance document associated with the project <strong>"${financeDocument.projName}"</strong> has been deleted.</p>
                    <p style="font-size: 16px; color: #555;">If this was not expected, please contact the team for clarification.</p>
        
                    <p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification. Do not reply to this email.</p>
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
          console.log(`Email sent to project owner: ${owner.ownerId.email}`);
        } catch (error) {
          console.error(
            `Error sending email to ${owner.ownerId.email}:`,
            error.message
          );
        }
      }
    }

    // Prepare and send emails to project members
    for (const member of project.members) {
      if (member?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: member.email,
          subject: `Finance Document Deleted for Project: ${financeDocument.projName}`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <title>Finance Document Deleted</title>
            </head>
            <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding: 20px; text-align: center;">
                    <h2 style="color: #d9534f;">Finance Document Deleted</h2>
                    <p style="font-size: 16px; color: #555;">Dear <strong>${member.userName || "Project Member"}</strong>,</p>
                    <p style="font-size: 16px; color: #555;">A finance document associated with the project <strong>"${financeDocument.projName}"</strong> has been deleted.</p>
                    <p style="font-size: 16px; color: #555;">Please log in to view the latest changes or contact the team if you have any questions.</p>
        
                    <p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification. Do not reply to this email.</p>
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
          console.log(`Email sent to member: ${member.email}`);
        } catch (error) {
          console.error(
            `Error sending email to ${member.email}:`,
            error.message
          );
        }
      }
    }

    res
      .status(200)
      .json({ message: "Document deleted and notifications sent!" });

    await Promise.all(notificationPromises);
    await session.commitTransaction();

    res.status(200).json({
      message: "Document deleted successfully!",
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(500).json({
      message: "Error deleting document",
      error: error.message,
    });
  } finally {
    session.endSession();
  }
};

export {
  uploadFinanceDocument,
  getFinanceDocuments,
  updateFinanceDocument,
  deleteFinanceDocument,
};
