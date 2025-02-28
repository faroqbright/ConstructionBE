import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import FinanceDocument from "../models/finance.model.js";
import { editProject } from "../models/project.model.js";

const uploadFinanceDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { projName, user, financialExecution, physicalExecution } = req.body;

    if (financialExecution < 0 || financialExecution > 100 || physicalExecution < 0 || physicalExecution > 100) {
      return res.status(400).json({ message: "Execution values must be between 0 and 100" });
    }

    // Check if the project exists in editProject schema
    const projectExists = await editProject.findOne({ projectName: projName });
    if (!projectExists) {
      return res.status(404).json({ message: "Project not found" });
    }

    // Upload file to AWS S3
    const fileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!fileUrl) {
      return res.status(500).json({ message: "File upload failed" });
    }

    // Create document entry in MongoDB
    const financeDocument = new FinanceDocument({
      projName,
      fileName: req.file.originalname,
      fileUrl,
      user,
      financialExecution,
      physicalExecution,
    });

    await financeDocument.save();
    res.status(201).json({ message: "File uploaded successfully!", financeDocument });
  } catch (error) {
    res.status(500).json({ message: "Error uploading file", error: error.message });
  }
};

const getFinanceDocuments = async (req, res) => {
  try {
    const { status, isMain, loggedInUserId, validStatuses } = req.body; // Assuming these values are coming from the request

    const filter = {
      ...(status && validStatuses.includes(status) ? { status } : {}),
      ...(!isMain ? { $or: [{ members: loggedInUserId }, { "projectOwners.ownerId": loggedInUserId }] } : {}),
    };

    // Fetch documents with applied filter
    const financeDocuments = await FinanceDocument.find(filter);

    res.status(200).json(financeDocuments);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch documents", error: error.message });
  }
};

const updateFinanceDocument = async (req, res) => {
  try {
    const { id } = req.params;
    let updates = {};

    const existingDocument = await FinanceDocument.findById(id);
    if (!existingDocument) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (req.body.projName) {
      // Check if the project exists in editProject schema
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

    if (req.file) {
      const oldFileKey = existingDocument.fileUrl.split(".com/")[1];
      await deleteFromS3(oldFileKey);
      const newFileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
      updates.fileName = req.file.originalname;
      updates.fileUrl = newFileUrl;
    }

    if (Object.keys(updates).length === 0) {
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
