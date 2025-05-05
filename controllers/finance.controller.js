import mongoose from 'mongoose';
import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import  {SendEmailUtil} from "../utils/emailsender.js"
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

    const projectOwners = projectExists.projectOwners
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
          text: `Hello ${owner.ownerId.userName},\n\nA new file named "${finalFileName}" has been uploaded for the project "${projName}".\n\nBest regards,\nYour Team`,
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

    const finalFileName = fileName.includes(".") ? fileName : `${fileName}.${req.file.mimetype.split("/")[1]}`;

    const fileUrl = await uploadToS3(req.file.buffer, finalFileName, req.file.mimetype);
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
      ...project.members.map(m => m._id),
      ...project.projectOwners.map(o => o.ownerId?._id).filter(Boolean),
      req.user._id
    ].filter((v, i, a) => a.findIndex(t => t.toString() === v.toString()) === i);

    // Create notifications
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
      const { id } = req.params;
      let updates = {}; // Initialize updates object
      // let project = null; // Declare project variable here, initialized to null

      // Fetch the existing document
      const existingDocument = await FinanceDocument.findById(id).session(session);
      if (!existingDocument) {
          await session.abortTransaction();
          session.endSession();
          return res.status(404).json({ message: "Document not found" });
      }
      let notify = false;

      // Determine which project name to use for fetching project details
      const projectNameToFetch = req.body.projName || existingDocument.projName;

      // Fetch project details (needed for validation AND/OR notification)
      // Ensure you populate needed fields if used elsewhere
      project = await editProject.findOne({ projectName: projectNameToFetch })
          // .populate("projectOwners.ownerId", "email userName") // Populate only if needed for other logic
          // .populate("members", "email userName")             // Populate only if needed for other logic
          .session(session);

      if (!project) {
          // If the intended project (new or old) doesn't exist
          await session.abortTransaction();
          session.endSession();
          // Be specific if the new name caused the failure
          const message = req.body.projName
              ? `Project '${req.body.projName}' not found.`
              : `Associated project '${existingDocument.projName}' not found.`;
          return res.status(404).json({ message });
      }

      if (req.body.projName && req.body.projName !== existingDocument.projName) {
          updates.projName = req.body.projName;
      }

      if (req.file) {
           if (existingDocument.fileUrl) {
              try {
                  const urlParts = existingDocument.fileUrl.split(".com/");
                  if (urlParts.length > 1) await deleteFromS3(urlParts[1]);
              } catch (s3DeleteError) { console.error("Failed to delete old S3 file:", s3DeleteError); }
           }
           const uniqueFileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '_')}`;
           const newFileUrl = await uploadToS3(req.file.buffer, uniqueFileName, req.file.mimetype);
           if (!newFileUrl) throw new Error("S3 upload failed during update");
           updates.fileName = req.file.originalname;
           updates.fileUrl = newFileUrl;
      }

      // --- 3. Handle Other Fields (financialExecution, physicalExecution, reference) ---
      if (req.body.financialExecution !== undefined && req.body.financialExecution !== null) {
           const financialExec = parseFloat(req.body.financialExecution);
           notify = true;
           if (!isNaN(financialExec) && financialExec >= 0 && financialExec <= 100) {
              updates.financialExecution = financialExec;
           } else { console.warn(`Invalid financialExecution: ${req.body.financialExecution}`); }
      }
      if (req.body.physicalExecution !== undefined && req.body.physicalExecution !== null) {
          const physicalExec = parseFloat(req.body.physicalExecution);
          notify = true;
           if (!isNaN(physicalExec) && physicalExec >= 0 && physicalExec <= 100) {
              updates.physicalExecution = physicalExec;
           } else { console.warn(`Invalid physicalExecution: ${req.body.physicalExecution}`); }
      }
       if (req.body.reference !== undefined) { // Allow empty string ""
          updates.reference = req.body.reference;
          notify = true;
      }
       if (req.body.fileName !== undefined) { // Allow empty string ""
          updates.fileName = req.body.fileName;
          notify = true;
      }
       if (!notify) { // Allow empty string ""
          return res.status(400).json({ message: "No chnges detect" })
      }

      // --- 4. Check if any actual updates were prepared ---
      // Only proceed if there are changes other than just the timestamp
      if (Object.keys(updates).length === 0) {
           await session.abortTransaction();
           session.endSession();
          return res.status(400).json({ message: "No update data provided or no changes detected" });
      }

      // Add update timestamp
      updates.uploadedAt = new Date(); // Or use a dedicated 'updatedAt' field

      // --- 5. Perform Database Update ---
      const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
          id,
          updates,
          { new: true, runValidators: true, session } // runValidators is good practice
      );

      const project = await editProject.findOne({ projectName: existingDocument.projName })
      .populate("projectOwners.ownerId", "email userName")
      .populate("members", "email userName");

    if (!project) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

    for (const owner of project.projectOwners) {
      if (owner.ownerId?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: owner.ownerId.email,
          subject: `Finance Document Updated for Project: ${existingDocument.projName}`,
          text: `Hello ${owner.ownerId.userName || "Project Owner"},\n\nA finance document for the project "${existingDocument.projName}" has been updated.\n\nBest regards,\nYour Team`,
        };

        try {
          await SendEmailUtil(emailBody);
          console.log(`Email sent to project owner: ${owner.ownerId.email}`);
        } catch (error) {
          console.error(`Error sending email to ${owner.ownerId.email}:`, error.message);
        }
      }
    }

    for (const member of project.members) {
      if (member?.email) {
        const emailBody = {
          from: process.env.EMAIL_USER,
          to: member.email,
          subject: `Finance Document Updated for Project: ${existingDocument.projName}`,
          text: `Hello ${member.userName || "Project Member"},\n\nA finance document for the project "${existingDocument.projName}" has been updated.\n\nBest regards,\nYour Team`,
        };

        try {
          await SendEmailUtil(emailBody);
          console.log(`Email sent to member: ${member.email}`);
        } catch (error) {
          console.error(`Error sending email to ${member.email}:`, error.message);
        }
      }
    }

      if (!updatedFinanceDocument) {
          // Should not happen if findById worked, but handle defensively
           await session.abortTransaction();
           session.endSession();
          return res.status(404).json({ message: "Document not found during the update operation." });
      }


      // --- 6. Create Update Notification ---
      // Now 'project' is guaranteed to be defined (either the new or old project object, or null if fetch failed earlier)
      // Use project._id directly since we checked for !project earlier
      const notificationData = {
          title: "Finance Document Updated",
          type: "Document Update",
          description: `Document "${updatedFinanceDocument.fileName || existingDocument.fileName}" for project "${project.projectName}" was updated.`, // Use updated name if available
          memberId: req.user._id, // Assumes req.user is populated by auth middleware
          projectId: project._id, // Use the fetched project's ID
      };

       // Create notification within the session
      await ShowNotification.create([notificationData], { session }); // Use array form for create with session

      // --- 7. Commit Transaction ---
      await session.commitTransaction();

      res.status(200).json({
          message: "Document updated successfully",
          document: updatedFinanceDocument
      });

  } catch (error) {
      console.error("Error updating finance document:", error);
      await session.abortTransaction(); // Ensure abortion on any error
      res.status(500).json({
          message: "Error updating document",
          error: error.message
      });
  } finally {
      session.endSession(); // Always end the session
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
          text: `Hello ${owner.ownerId.userName || "Project Owner"},\n\nA finance document associated with the project "${financeDocument.projName}" has been deleted.\n\nBest regards,\nYour Team`,
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
          text: `Hello ${member.userName || "Project Member"},\n\nA finance document associated with the project "${financeDocument.projName}" has been deleted.\n\nBest regards,\nYour Team`,
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
    await session.commitTransaction();

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

export { uploadFinanceDocument, getFinanceDocuments, updateFinanceDocument, deleteFinanceDocument };
