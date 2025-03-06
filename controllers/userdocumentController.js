import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import UserDocument from "../models/userdocumentModel.js";
import { editProject } from "../models/project.model.js";

const uploadUserDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const { projName, user } = req.body;

    // Check if the project exists in editProject schema
    const projectExists = await editProject.findOne({ projectName: projName });

    if (!projectExists) {
      return res.status(404).json({ message: "Project not found" });
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
    const userDocument = new UserDocument({
      projName,
      fileName: req.file.originalname,
      fileUrl,
      user,
    });

    await userDocument.save();

    res.status(201).json({ message: "File uploaded successfully!", userDocument });
  } catch (error) {
    res.status(500).json({ message: "Error uploading file", error: error.message });
  }
};

const getUserDocuments = async (req, res) => {
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

    const userDocuments = await UserDocument.find({ projName: { $in: projectNames } })
      .sort({ uploadedAt: -1 });

    res.status(200).json(userDocuments);
  } catch (error) {
    console.error("Error fetching user documents:", error.message);
    res.status(500).json({ message: "Failed to fetch user documents", error: error.message });
  }
};

const updateUserDocumentStatus = async (req, res) => {
  try {
      const { id } = req.params;
      let updates = {};

      // Fetch existing document
      const existingDocument = await UserDocument.findById(id);
      if (!existingDocument) {
          return res.status(404).json({ message: "Document not found" });
      }

      // Update the project name if it exists in form-data
      if (req.body.projName) {
          updates.projName = req.body.projName;
      }

      // Handle file update if a new file is provided
      if (req.file) {
          const oldFileKey = existingDocument.fileUrl.split(".com/")[1]; // Extract old S3 key
          console.log("Deleting old file from S3:", oldFileKey);
          await deleteFromS3(oldFileKey); // Delete old file from S3

          // Upload new file
          const newFileUrl = await uploadToS3(req.file.buffer, req.file.originalname, req.file.mimetype);
          console.log("Uploaded new file to S3:", newFileUrl);

          updates.fileName = req.file.originalname;
          updates.fileUrl = newFileUrl;
      }

      // If no updates detected, return an error
      if (Object.keys(updates).length === 0) {
          return res.status(400).json({ message: "No changes detected" });
      }

      // Apply updates to MongoDB
      const updatedUserDocument = await UserDocument.findByIdAndUpdate(id, updates, { new: true });

      if (!updatedUserDocument) {
          return res.status(404).json({ message: "Document not found after update" });
      }

      res.status(200).json({ message: "Document updated successfully", document: updatedUserDocument });

  } catch (error) {
      console.error("Error updating document:", error);
      res.status(500).json({ message: "Error updating document", error: error.message });
  }
};

const deleteUserDocument = async (req, res) => {
    try {
        const userDocument = await UserDocument.findById(req.params.id);
        if (!userDocument) {
            return res.status(404).json({ message: "Document not found" });
        }

        // Delete from AWS S3
        const fileKey = userDocument.fileUrl.split('.com/')[1]; // Extract key from URL
        await deleteFromS3(fileKey);

        // Delete from MongoDB
        await UserDocument.findByIdAndDelete(req.params.id);

        res.status(200).json({ message: "Document deleted successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting document", error: error.message });
    }
};

export { uploadUserDocument, getUserDocuments, updateUserDocumentStatus, deleteUserDocument };
