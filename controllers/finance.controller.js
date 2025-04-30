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
    let updates = { uploadedAt: new Date() };

    const existingDocument = await FinanceDocument.findById(id).session(session);
    if (!existingDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (req.body.projName) {
      const project = await editProject.findOne({ projectName: req.body.projName })
        .populate("projectOwners.ownerId", "email userName")
        .populate("members", "email userName")
        .session(session);
      
      if (!project) {
        return res.status(404).json({ message: "Project not found" });
      }
      updates.projName = req.body.projName;
    }

    // ... (rest of your existing update logic) ...

    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(
      id, 
      updates, 
      { new: true, session }
    );

    // Create update notification
    const notification = await ShowNotification.create({
      title: "Finance Document Updated",
      type: "Document Update",
      description: `Document "${existingDocument.fileName}" was updated`,
      memberId: req.user._id,
      projectId: project?._id || existingDocument.projectId,
    });

    await session.commitTransaction();

    res.status(200).json({ 
      message: "Document updated successfully", 
      document: updatedFinanceDocument 
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
