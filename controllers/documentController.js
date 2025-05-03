import { deleteFromS3, uploadToS3 } from "../utils/uploadService.js";
import Document from "../models/documentModel.js";
import { editProject } from "../models/project.model.js";
// import  {SendEmailUtil} from "../utils/emailsender.js"
import {SendEmailUtil} from "../utils/emailsender.js"


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
      projName: req.body.projName || null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileUrl: fileUrl,
      user: req.body.user,
      status: "pending",
    });

    await document.save();

    // Fetch project owners if projName is provided
    if (req.body.projName) {
      const projectExists = await editProject.findOne({ projectName: req.body.projName }).populate("projectOwners.ownerId", "email ownerName");

      if (projectExists && projectExists.projectOwners.length > 0) {
        for (const owner of projectExists.projectOwners) {
          if (owner.ownerId?.email) {
            const emailBody = {
              from: process.env.EMAIL_USER,
              to: owner.ownerId.email,
              subject: `New File Uploaded for Project: ${req.body.projName}`,
              text: `Hello ${owner.ownerId.ownerName},\n\nA new file named "${req.file.originalname}" has been uploaded for the project "${req.body.projName}".\n\nBest regards,\nYour Team`,
            };

            try {
              await SendEmailUtil(emailBody);
              console.log(`Email sent to ${owner.ownerId.email}`);
            } catch (error) {
              console.error("Error sending email:", error.message);
            }
          }
        }
      } else {
        console.warn("No project owners found for the provided project name.");
      }
    }

    res.status(201).json({ message: "File uploaded successfully!", document });
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

    // Step 2: Find related project using projName
    const projectNameFromDocument = updatedDocument.projName;
    console.log("ddfdfdfd",projectNameFromDocument);

    const relatedProject = await editProject
      .findOne({ projectName: projectNameFromDocument })
      .populate("projectOwners.ownerId", "email ownerName") // populate owner emails
      .populate("members", "email userName"); // correctly populate member emails

    if (!relatedProject) {
      return res.status(404).json({ message: "Project not found for this document" });
    }

    // Step 3: Collect owner and member emails
    const ownerEmails = relatedProject.projectOwners
      .map((owner) => owner.ownerId?.email)
      .filter(Boolean);
    
      console.log("owner",ownerEmails);

    const memberEmails = relatedProject.members
      .map((member) => member?.email)
      .filter(Boolean);
      
      console.log("member",memberEmails);
    

    const allEmails = [...new Set([...ownerEmails, ...memberEmails])]; // Unique emails

    // Step 4: Send emails
    for (const email of allEmails) {
      try {
        await SendEmailUtil({
          to: email,
          subject: "Document Status Updated",
          text: `The status of document "${updatedDocument.fileName}" in project "${projectNameFromDocument}" has been updated to "${updatedDocument.status}".`,
        });
        console.log(`✅ Email sent to: ${email}`);
      } catch (emailErr) {
        console.error(`❌ Failed to send email to ${email}:`, emailErr.message);
      }
    }

    // Step 5: Response
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

        // Delete from MongoDB
        await Document.findByIdAndDelete(req.params.id);

        res.status(200).json({ message: "Document deleted successfully!" });
    } catch (error) {
        res.status(500).json({ message: "Error deleting document", error: error.message });
    }
};

export { uploadFile, getDocuments, updateStatus , deleteDocument };
