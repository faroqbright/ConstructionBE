import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";

const uploadFile = async (req, res) => {
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

    // Create document entry in MongoDB
    const document = new Document({
      projName: req.body.projName || null, // Optional for regular users
      fileName: req.file.originalname,
      fileSize: req.file.size, // Capture file size in bytes
      fileUrl: fileUrl,
      user: req.body.user, // Assuming `req.user` has user info
      status: "pending",
    });

    await document.save();

    res.status(201).json({ message: "File uploaded successfully!", document });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error uploading file", error: error.message });
  }
};

/**
 * Fetch all uploaded documents
 */
const getDocuments = async (req, res) => {
  try {
    const documents = await Document.find();

    res.status(200).json(documents);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch documents", error: error.message });
  }
};

/**
 * Update document status (Approve/Reject)
 */
const updateStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body; // Only send changed fields

        const updatedDocument = await Document.findByIdAndUpdate(id, updates, { new: true });

        if (!updatedDocument) {
            return res.status(404).json({ message: "Document not found" });
        }

        res.status(200).json({ message: "Document updated successfully", document: updatedDocument });
    } catch (error) {
        res.status(500).json({ message: "Error updating document", error: error.message });
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

        // Delete from MongoDB
        await Document.findByIdAndDelete(req.params.id);

        res.status(200).json({ message: "Document deleted successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting document", error: error.message });
    }
};

export { uploadFile, getDocuments, updateStatus , deleteDocument };
