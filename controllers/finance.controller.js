import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";
import  {SendEmailUtil} from "../utils/emailsender.js"



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

    const projectExists = await editProject.findOne({ projectName: projName }).populate("projectOwners.ownerId", "email ownerName");
    
    if (!projectExists) {
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

    await financeDocument.save();

    // Check and send emails to project owners
    console.log(projectExists);
    
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

    res.status(201).json({ message: "File uploaded successfully!", financeDocument });
  } catch (error) {
    console.error("Error uploading file:", error.message);
    res.status(500).json({ message: "Error uploading file", error: error.message });
  }
};









const getFinanceDocuments = async (req, res) => {
  try {
    const { isMain, _id: loggedInUserId } = req.user;

    const assignedProjects = await editProject.find({
      ...(!isMain ? { $or: [{ members: loggedInUserId }, { "projectOwners.ownerId": loggedInUserId }] } : {}),
    });

    const projectNames = assignedProjects.map((proj) => proj.projectName);

    if (projectNames.length === 0) {
      console.log("No assigned projects found for this user.");
      return res.status(200).json({ message: "No assigned projects found" });
    }

    const financeDocuments = await FinanceDocument.find({ projName: { $in: projectNames } })
      .sort({ uploadedAt: -1 });  // Sort by uploadedAt in descending order (latest first)

    res.status(200).json(financeDocuments);
  } catch (error) {
    console.error("Error fetching finance documents:", error.message);
    res.status(500).json({ message: "Failed to fetch finance documents", error: error.message });
  }
};

const updateFinanceDocument = async (req, res) => {
  try {
    const { id } = req.params;
    let updates = { uploadedAt: new Date() }; // ✅ Always update timestamp

    const existingDocument = await FinanceDocument.findById(id);
    if (!existingDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (req.body.projName) {
      const projectExists = await editProject.findOne({ projectName: req.body.projName });
      if (!projectExists) {
        return res.status(404).json({ message: "Project not found" });
      }
      updates.projName = req.body.projName;
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
      updates.reference = req.body.reference; // ✅ Made reference editable
    }

    if (req.file) {
      const newFileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
      updates.fileName = req.file.originalname;
      updates.fileUrl = newFileUrl;

      // ✅ Delete only if upload succeeds
      if (newFileUrl && existingDocument.fileUrl) {
        const oldFileKey = existingDocument.fileUrl.split(".com/")[1];
        await deleteFromS3(oldFileKey);
      }
    }

    if (Object.keys(updates).length === 1) { // Only `uploadedAt` present means no real updates
      return res.status(400).json({ message: "No changes detected" });
    }

    const updatedFinanceDocument = await FinanceDocument.findByIdAndUpdate(id, updates, { new: true });
    res.status(200).json({ message: "Document updated successfully", document: updatedFinanceDocument });
  } catch (error) {
    res.status(500).json({ message: "Error updating document", error: error.message });
  }
};

const deleteFinanceDocument = async (req, res) => {
  try {
    const financeDocument = await FinanceDocument.findById(req.params.id);
    if (!financeDocument) {
      return res.status(404).json({ message: "Document not found" });
    }
    const fileKey = financeDocument.fileUrl.split(".com/")[1];
    await deleteFromS3(fileKey);
    await FinanceDocument.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Document deleted successfully!" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting document", error: error.message });
  }
};

export { uploadFinanceDocument, getFinanceDocuments, updateFinanceDocument, deleteFinanceDocument };
