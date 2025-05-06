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

    // Upload to S3
    const fileUrl = await uploadToS3(req.file.buffer, finalFileName, req.file.mimetype);
    if (!fileUrl) {
      return res.status(500).json({ message: "File upload failed" });
    }

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

// const updateFinanceDocument = async (req, res) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//       const { id } = req.params;
//       let updates = {}; // Initialize updates object
//       // let project = null; // Declare project variable here, initialized to null

//       // Fetch the existing document
//       const existingDocument = await FinanceDocument.findById(id).session(session);
//       if (!existingDocument) {
//           await session.abortTransaction();
//           session.endSession();
//           return res.status(404).json({ message: "Document not found" });
//       }
//       let notify = false;

//       // Determine which project name to use for fetching project details
//       const projectNameToFetch = req.body.projName || existingDocument.projName;

//       // Fetch project details (needed for validation AND/OR notification)
//       // Ensure you populate needed fields if used elsewhere
//       project = await editProject.findOne({ projectName: projectNameToFetch })
//           // .populate("projectOwners.ownerId", "email userName") // Populate only if needed for other logic
//           // .populate("members", "email userName")             // Populate only if needed for other logic
//           .session(session);

//       if (!project) {
//           // If the intended project (new or old) doesn't exist
//           await session.abortTransaction();
//           session.endSession();
//           // Be specific if the new name caused the failure
//           const message = req.body.projName
//               ? `Project '${req.body.projName}' not found.`
//               : `Associated project '${existingDocument.projName}' not found.`;
//           return res.status(404).json({ message });
//       }

//       if (req.body.projName && req.body.projName !== existingDocument.projName) {
//           updates.projName = req.body.projName;
//       }

//       if (req.file) {
//            if (existingDocument.fileUrl) {
//               try {
//                   const urlParts = existingDocument.fileUrl.split(".com/");
//                   if (urlParts.length > 1) await deleteFromS3(urlParts[1]);
//               } catch (s3DeleteError) { console.error("Failed to delete old S3 file:", s3DeleteError); }
//            }
//            const uniqueFileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
//            const newFileUrl = await uploadToS3(req.file.buffer, uniqueFileName, req.file.mimetype);
//            if (!newFileUrl) throw new Error("S3 upload failed during update");
//            updates.fileName = req.file.originalname;
//            updates.fileUrl = newFileUrl;
//       }

//       // --- 3. Handle Other Fields (financialExecution, physicalExecution, reference) ---
//       if (req.body.financialExecution !== undefined && req.body.financialExecution !== null) {
//            const financialExec = parseFloat(req.body.financialExecution);
//            notify = true;
//            if (!isNaN(financialExec) && financialExec >= 0 && financialExec <= 100) {
//               updates.financialExecution = financialExec;
//            } else { console.warn(`Invalid financialExecution: ${req.body.financialExecution}`); }
//       }
//       if (req.body.physicalExecution !== undefined && req.body.physicalExecution !== null) {
//           const physicalExec = parseFloat(req.body.physicalExecution);
//           notify = true;
//            if (!isNaN(physicalExec) && physicalExec >= 0 && physicalExec <= 100) {
//               updates.physicalExecution = physicalExec;
//            } else { console.warn(`Invalid physicalExecution: ${req.body.physicalExecution}`); }
//       }
//        if (req.body.reference !== undefined) { // Allow empty string ""
//           updates.reference = req.body.reference;
//           notify = true;
//       }
//        if (req.body.fileName !== undefined) { // Allow empty string ""
//           updates.fileName = req.body.fileName;
//           notify = true;
//       }
//        if (!notify) { // Allow empty string ""
//           return res.status(400).json({ message: "No chnges detect" })
//       }

//       // --- 4. Check if any actual updates were prepared ---
//       // Only proceed if there are changes other than just the timestamp
//       if (Object.keys(updates).length === 0) {
//            await session.abortTransaction();
//            session.endSession();
//           return res.status(400).json({ message: "No update data provided or no changes detected" });
//       }

//       // Add update timestamp
//       updates.uploadedAt = new Date(); // Or use a dedicated 'updatedAt' field

//       // --- 5. Perform Database Update ---
//       const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
//           id,
//           updates,
//           { new: true, runValidators: true, session } // runValidators is good practice
//       );

//       const project = await editProject.findOne({ projectName: existingDocument.projName })
//       .populate("projectOwners.ownerId", "email userName")
//       .populate("members", "email userName");

//     if (!project) {
//       return res.status(404).json({ message: "Project not found for this document" });
//     }

//     for (const owner of project.projectOwners) {
//       if (owner.ownerId?.email) {
//         const emailBody = {
//           from: process.env.EMAIL_USER,
//           to: owner.ownerId.email,
//           subject: `Finance Document Updated for Project: ${existingDocument.projName}`,
//           html: `
//             <!DOCTYPE html>
//             <html lang="en">
//             <head>
//               <meta charset="UTF-8">
//               <title>Finance Document Update</title>
//             </head>
//             <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
//               <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
//                 <tr>
//                   <td style="padding: 20px; text-align: center;">
//                     <h2 style="color: #333;">Finance Document Updated</h2>
//                     <p style="font-size: 16px; color: #555;">Dear <strong>${owner.ownerId.userName || "Project Owner"}</strong>,</p>
//                     <p style="font-size: 16px; color: #555;">A finance document for the project <strong>"${existingDocument.projName}"</strong> has been updated.</p>
//                     <p style="font-size: 16px; color: #555;">Please log in to your dashboard to view the latest version.</p>
        
//                     <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions, feel free to contact our team.</p>
//                     <p style="font-size: 14px; color: #999;">Best regards,<br><strong>Your Team</strong></p>
//                   </td>
//                 </tr>
//               </table>
//             </body>
//             </html>
//           `,
//         };        

//         try {
//           await SendEmailUtil(emailBody);
//           console.log(`Email sent to project owner: ${owner.ownerId.email}`);
//         } catch (error) {
//           console.error(`Error sending email to ${owner.ownerId.email}:`, error.message);
//         }
//       }
//     }

//     for (const member of project.members) {
//       if (member?.email) {
//         const emailBody = {
//           from: process.env.EMAIL_USER,
//           to: member.email,
//           subject: `Finance Document Updated for Project: ${existingDocument.projName}`,
//           html: `
//             <!DOCTYPE html>
//             <html lang="en">
//             <head>
//               <meta charset="UTF-8">
//               <title>Finance Document Update</title>
//             </head>
//             <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
//               <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
//                 <tr>
//                   <td style="padding: 20px; text-align: center;">
//                     <h2 style="color: #333;">Finance Document Updated</h2>
//                     <p style="font-size: 16px; color: #555;">Dear <strong>${member.userName || "Project Member"}</strong>,</p>
//                     <p style="font-size: 16px; color: #555;">A finance document for the project <strong>"${existingDocument.projName}"</strong> has been updated.</p>
//                     <p style="font-size: 16px; color: #555;">Please log in to your dashboard to review the updated document.</p>
        
//                     <p style="font-size: 14px; color: #999; margin-top: 30px;">If you have any questions, feel free to contact our team.</p>
//                     <p style="font-size: 14px; color: #999;">Best regards,<br><strong>Your Team</strong></p>
//                   </td>
//                 </tr>
//               </table>
//             </body>
//             </html>
//           `,
//         };
        
//         try {
//           await SendEmailUtil(emailBody);
//           console.log(`Email sent to member: ${member.email}`);
//         } catch (error) {
//           console.error(`Error sending email to ${member.email}:`, error.message);
//         }
//       }
//     }

//       if (!updatedFinanceDocument) {
//           // Should not happen if findById worked, but handle defensively
//            await session.abortTransaction();
//            session.endSession();
//           return res.status(404).json({ message: "Document not found during the update operation." });
//       }


//       // --- 6. Create Update Notification ---
//       // Now 'project' is guaranteed to be defined (either the new or old project object, or null if fetch failed earlier)
//       // Use project._id directly since we checked for !project earlier
//       const notificationData = {
//           title: "Finance Document Updated",
//           type: "Document Update",
//           description: `Document "${updatedFinanceDocument.fileName || existingDocument.fileName}" for project "${project.projectName}" was updated.`, // Use updated name if available
//           memberId: req.user._id, // Assumes req.user is populated by auth middleware
//           projectId: project._id, // Use the fetched project's ID
//       };

//        // Create notification within the session
//       await ShowNotification.create([notificationData], { session }); // Use array form for create with session

//       // --- 7. Commit Transaction ---
//       await session.commitTransaction();

//       res.status(200).json({
//           message: "Document updated successfully",
//           document: updatedFinanceDocument
//       });

//   } catch (error) {
//       console.error("Error updating finance document:", error);
//       await session.abortTransaction(); // Ensure abortion on any error
//       res.status(500).json({
//           message: "Error updating document",
//           error: error.message
//       });
//   } finally {
//       session.endSession(); // Always end the session
//   }
// };


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
      return res.status(404).json({ message: "Document not found" });
    }

    const project = await editProject.findOne({ projectName: financeDocument.projName })
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
          console.error(`Error sending email to ${owner.ownerId.email}:`, error.message);
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
          console.error(`Error sending email to ${member.email}:`, error.message);
        }
      }
    }

    res.status(200).json({ message: "Document deleted and notifications sent!" });

    await Promise.all(notificationPromises);
   // await session.commitTransaction();

    res.status(200).json({ 
      message: "Document deleted successfully!" 
    });

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

export {
  uploadFinanceDocument,
  getFinanceDocuments,
  updateFinanceDocument,
  deleteFinanceDocument,
};
