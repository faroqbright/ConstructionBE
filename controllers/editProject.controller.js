import { editProject } from "../models/project.model.js";
import { User } from "../models/user.model.js"
import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";
import UserDocument from "../models/userdocumentModel.js";
import Document from "../models/documentModel.js";
import FinanceDocument from "../models/finance.model.js";
import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { SendEmailUtil } from "../utils/emailsender.js";
import { ShowNotification } from "../models/showNotificationSchema.js";

const createProject = asyncHandler(async (req, res) => {
  try {
    const {
      projectName,
      projectOwners,
      description,
      location,
      status,
      businessAreas,
      comapanyName,
      deadline,
      physicalEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;

    console.log("Received Project Data:", req.body);
    console.log("Received Files:", files?.projectBanner?.length);

    const existingProject = await editProject.findOne({ projectName });
    if (existingProject) {
      throw new ApiError(400, "Project name already taken.");
    }

    let projectBanners = [];

    if (files?.projectBanner?.length > 0) {
      if (files.projectBanner.length > 10) {
        throw new ApiError(400, "You can upload up to 10 banners.");
      }

      const uploadFile = async (file) => {
        if (file.size > 5 * 1024 * 1024) {
          console.error(`File too large: ${file.originalname}`);
          return null;
        }

        try {
          console.log(`Uploading file: ${file.originalname}`);
          const uniqueFileName = `${uuidv4()}-${file.originalname}`;
          const uploadedImageUrl = await uploadToS3(
            file.buffer,
            uniqueFileName,
            file.mimetype
          );
          return uploadedImageUrl
            ? { url: uploadedImageUrl, uploadDate: new Date() }
            : null;
        } catch (uploadError) {
          console.error(`Upload failed for ${file.originalname}:`, uploadError);
          return null; // Do not fail everything if one file fails
        }
      };

      // Upload in batches of 3 (prevents memory overload)
      const batchSize = 3;
      for (let i = 0; i < files.projectBanner.length; i += batchSize) {
        const batch = files.projectBanner.slice(i, i + batchSize);
        console.log(`Uploading batch: ${i / batchSize + 1}`);
        const uploadedBatch = await Promise.allSettled(batch.map(uploadFile));
        projectBanners.push(
          ...uploadedBatch
            .filter((result) => result.status === "fulfilled" && result.value)
            .map((result) => result.value)
        );
      }
    }

    console.log("Uploaded Banners:", projectBanners);

    const projectData = {
      projectName,
      projectOwners,
      description,
      businessAreas,
      comapanyName,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      projectBanner: projectBanners,
    };

    const project = await editProject.create(projectData);
    res
      .status(201)
      .json(new ApiResponse(201, project, "Project created successfully"));
  } catch (error) {
    console.error("Error in createProject:", error);
    res.status(500).json({ message: error.message || "Internal Server Error" });
  }
});

// const editProjects = asyncHandler(async (req, res) => {
//   try {
//     const { projectId } = req.params;
//     const {
//       projectName,
//       projectOwners,
//       description,
//       location,
//       businessAreas,
//       comapanyName,
//       status,
//       deadline,
//       physicalEducationRange,
//       daysLeft,
//       members,
//       removeBanners = [],
//     } = req.body;

//     const { files } = req;

//     const existingProject = await editProject.findById(projectId).populate("projectOwners.ownerId", "email userName");

//     if (!existingProject) {
//       throw new ApiError(404, "Project not found");
//     }

//     let updateData = {};
//     let logs = [];
//     let updatedProjectBanners = existingProject.projectBanner || [];
//     let changesSummary = [];

//     // ✅ Project name change
//     let updatedProjectName = existingProject.projectName;
//     if (projectName && projectName !== existingProject.projectName) {
//       const nameTaken = await editProject.findOne({ projectName });
//       if (nameTaken) {
//         const uniqueSuffix = uuidv4().split("-")[0];
//         updatedProjectName = `${projectName}-${uniqueSuffix}`;
//       } else {
//         updatedProjectName = projectName;
//       }

//       logs.push({
//         actionType: "Project Name Change",
//         message: `Project name changed from "${existingProject.projectName}" to "${updatedProjectName}" by ${req.user.userName}`,
//         userId: req.user.id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`Project name changed to "${updatedProjectName}"`);
//     }

//     // ✅ Status change
//     if (status && status !== existingProject.status) {
//       logs.push({
//         actionType: "Status Update",
//         message: `Status changed from "${existingProject.status}" to "${status}" by ${req.user.userName}`,
//         userId: req.user.id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`Status updated to "${status}"`);
//     }

//     // ✅ Deadline change
//     if (deadline) {
//       const parsedDeadline = new Date(deadline);
//       const existingDeadline = existingProject.deadline ? new Date(existingProject.deadline) : null;

//       if (isNaN(parsedDeadline.getTime())) {
//         throw new ApiError(400, "Invalid deadline value provided");
//       }

//       if (!existingDeadline || parsedDeadline.toISOString() !== existingDeadline.toISOString()) {
//         logs.push({
//           actionType: "Deadline Change",
//           message: `Deadline updated to "${parsedDeadline.toISOString()}" by ${req.user.userName}`,
//           userId: req.user.id,
//           timestamp: new Date(),
//         });
//         changesSummary.push(`Deadline updated to "${parsedDeadline.toISOString()}"`);
//       }
//     }

//     // ✅ Remove banners
//     if (removeBanners.length > 0) {
//       updatedProjectBanners = updatedProjectBanners.filter(
//         (banner) => !removeBanners.includes(banner.url)
//       );
//       logs.push({
//         actionType: "Project Banner Removal",
//         message: `Removed ${removeBanners.length} banner(s) by ${req.user.userName}`,
//         userId: req.user.id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`${removeBanners.length} banner(s) removed`);
//     }

//     // ✅ Add banners
//     if (files?.projectBanner?.length > 0) {
//       if (updatedProjectBanners.length + files.projectBanner.length > 10) {
//         throw new ApiError(400, "You can only have up to 10 banners.");
//       }

//       for (const file of files.projectBanner) {
//         const uniqueFileName = `${uuidv4()}-${file.originalname}`;
//         const uploadedImageUrl = await uploadToS3(file.buffer, uniqueFileName, file.mimetype);
//         if (uploadedImageUrl) {
//           updatedProjectBanners.push({
//             url: uploadedImageUrl,
//             uploadDate: new Date(),
//           });
//         }
//       }

//       logs.push({
//         actionType: "Project Banner Addition",
//         message: `Added ${files.projectBanner.length} new banner(s) by ${req.user.userName}`,
//         userId: req.user.id,
//         timestamp: new Date(),
//       });
//       changesSummary.push(`${files.projectBanner.length} new banner(s) added`);
//     }

//     // ✅ Update finance document timestamps
//     if (req.body.financeDocuments?.length > 0) {
//       for (const docId of req.body.financeDocuments) {
//         await FinanceDocument.findByIdAndUpdate(docId, {
//           $set: { uploadedAt: new Date() },
//         });
//       }
//     }

//     // ✅ Construct updateData
//     updateData = {
//       ...updateData,
//       projectName: updatedProjectName,
//       description,
//       location,
//       status,
//       businessAreas,
//       comapanyName,
//       deadline,
//       physicalEducationRange,
//       daysLeft,
//       projectBanner: updatedProjectBanners,
//       ...(members && { members }),
//       ...(projectOwners && {
//         projectOwners: projectOwners
//           .filter((ownerId) => ownerId)
//           .map((ownerId) => ({
//             ownerId: new mongoose.Types.ObjectId(ownerId),
//           })),
//       }),
//       logs: [...existingProject.logs, ...logs],
//     };

//     // ✅ Update project in DB
//     const updatedProject = await editProject.findByIdAndUpdate(projectId, { $set: updateData }, { new: true });

//     // ✅ Send email notification
//     const emailRecipients = existingProject.projectOwners
//       .map((owner) => owner.ownerId?.email)
//       .filter(Boolean);

//     const emailBody = {
//       from: process.env.EMAIL_USER,
//       to: emailRecipients.join(","),
//       subject: `🔔 Project "${existingProject.projectName}" has been updated`,
//       html: `
//         <h3>Project Updated</h3>
//         <p>The following changes were made to <strong>${existingProject.projectName}</strong>:</p>
//         <ul>
//           ${changesSummary.length > 0 ? changesSummary.map(change => `<li>${change}</li>`).join("") : "<li>No significant changes detected.</li>"}
//         </ul>
//         <p><strong>Updated by:</strong> ${req.user.userName}</p>
//         <p style="font-size: 0.9em;"><em>This is an automated notification email.</em></p>
//       `,
//     };

//     await SendEmailUtil(emailBody);

//     res
//       .status(200)
//       .json(new ApiResponse(200, updatedProject, "Project updated successfully"));
//   } catch (error) {
//     console.error("Error updating project:", error.message);
//     res.status(500).json({ message: error.message || "Internal Server Error" });
//   }
// });

// const createProject = asyncHandler(async (req, res) => {
//   try {
//     const {
//       projectName,
//       projectOwners,
//       description,
//       location,
//       status,
//       businessAreas,
//       comapanyName,
//       deadline,
//       physicalEducationRange,
//       daysLeft,
//     } = req.body;
//     const { files } = req;

//     console.log("Received Project Data:", req.body);
//     console.log("Received Files:", files?.projectBanner?.length);

//     const existingProject = await editProject.findOne({ projectName });
//     if (existingProject) {
//       throw new ApiError(400, "Project name already taken.");
//     }

//     let projectBanners = [];

//     // Check if projectBanner files exist
//     if (files?.projectBanner?.length > 0) {
//       if (files.projectBanner.length > 10) {
//         throw new ApiError(400, "You can upload up to 10 banners.");
//       }

//       const uploadFile = async (file) => {
//         if (file.size > 5 * 1024 * 1024) {
//           console.error(`File too large: ${file.originalname}`);
//           return null;
//         }

//         try {
//           console.log(`Uploading file: ${file.originalname}`);
//           const uniqueFileName = `${uuidv4()}-${file.originalname}`;
//           const uploadedImageUrl = await uploadToS3(
//             file.buffer,
//             uniqueFileName,
//             file.mimetype
//           );
//           return uploadedImageUrl
//             ? { url: uploadedImageUrl, uploadDate: new Date() }
//             : null;
//         } catch (uploadError) {
//           console.error(`Upload failed for ${file.originalname}:`, uploadError);
//           return null; // Do not fail everything if one file fails
//         }
//       };

//       // Upload in batches of 3 (prevents memory overload)
//       const batchSize = 3;
//       for (let i = 0; i < files.projectBanner.length; i += batchSize) {
//         const batch = files.projectBanner.slice(i, i + batchSize);
//         console.log(`Uploading batch: ${i / batchSize + 1}`);
//         const uploadedBatch = await Promise.allSettled(batch.map(uploadFile));
//         projectBanners.push(
//           ...uploadedBatch
//             .filter((result) => result.status === "fulfilled" && result.value)
//             .map((result) => result.value)
//         );
//       }
//     }

//     console.log("Uploaded Banners:", projectBanners);

//     const projectData = {
//       projectName,
//       projectOwners,
//       description,
//       businessAreas,
//       comapanyName,
//       location,
//       status,
//       deadline,
//       physicalEducationRange,
//       daysLeft,
//       projectBanner: projectBanners,
//     };

//     const project = await editProject.create(projectData);

//     const emailRecipients = (Array.isArray(projectOwners) ? projectOwners : [])
//       .map((ownerId) => ownerId?.email)
//       .filter(Boolean); // Filter out any falsy values

//     // Check if there are any recipients before sending the email
//     // if (emailRecipients.length === 0) {
//     //   throw new Error("No recipients defined");
//     // }

//     // const emailBody = {
//     //   from: process.env.EMAIL_USER,
//     //   to: emailRecipients.join(","),
//     //   subject: `🔔 New Project Created: ${projectName}`,
//     //   html: `
//     //     <h3>New Project Created</h3>
//     //     <p>A new project named <strong>${projectName}</strong> has been created with the following details:</p>
//     //     <ul>
//     //       <li><strong>Description:</strong> ${description}</li>
//     //       <li><strong>Status:</strong> ${status}</li>
//     //       <li><strong>Deadline:</strong> ${deadline}</li>
//     //     </ul>
//     //     <p><strong>Created by:</strong> ${req.user.userName}</p>
//     //     <p style="font-size: 0.9em;"><em>This is an automated notification email.</em></p>
//     //   `,
//     // };

//     // await SendEmailUtil(emailBody);

//     res
//       .status(201)
//       .json(new ApiResponse(201, project, "Project created successfully"));
//   } catch (error) {
//     console.error("Error in createProject:", error);
//     res.status(500).json({ message: error.message || "Internal Server Error" });
//   }
// });

const editProjects = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;

    // Validate projectId
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Invalid project ID");
    }

    const {
      projectName,
      projectOwners,
      description,
      location,
      businessAreas,
      comapanyName,
      members,
      status,
      deadline,
      removeBanners = [],
    } = req.body;

    const { files } = req;
    const performingUser = req.user;

    // Fetch project with better error handling
    const existingProject = await editProject
      .findById(projectId)
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .lean(); // Convert to plain JS object for better performance

    if (!existingProject) {
      throw new ApiError(404, "Project not found");
    }

    let updateData = {};
    let logs = [];
    let updatedProjectBanners = existingProject.projectBanner || [];
    let changesSummary = [];
    let importantFieldsChanged = false;
    let membersChanged = false;
    let ownersChanged = false;

    // 1. Project Name Update
    let updatedProjectName = existingProject.projectName;
    if (projectName && projectName !== existingProject.projectName) {
      const nameTaken = await editProject.findOne({
        projectName,
        _id: { $ne: projectId },
      });
      updatedProjectName = nameTaken
        ? `${projectName}-${uuidv4().split("-")[0]}`
        : projectName;

      logs.push({
        actionType: "Project Name Change",
        message: `Project name changed from "${existingProject.projectName}" to "${updatedProjectName}" by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`Project name changed to "${updatedProjectName}"`);
      importantFieldsChanged = true;
    }

    // 2. Status Update
    if (status && status !== existingProject.status) {
      logs.push({
        actionType: "Status Update",
        message: `Status changed from "${existingProject.status}" to "${status}" by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`Status updated to "${status}"`);
      importantFieldsChanged = true;
    }

    // 3. Deadline Update
    if (deadline && deadline !== existingProject.deadline) {
      logs.push({
        actionType: "Deadline Change",
        message: `Deadline updated to "${deadline}" by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`Deadline updated to "${deadline}"`);
      importantFieldsChanged = true;
    }

    // 4. Other Important Fields
    const fieldUpdates = [
      { field: "description", name: "Description" },
      { field: "location", name: "Location" },
      { field: "businessAreas", name: "Business Areas" },
      { field: "comapanyName", name: "Company Name" },
    ];

    fieldUpdates.forEach(({ field, name }) => {
      if (req.body[field] && req.body[field] !== existingProject[field]) {
        logs.push({
          actionType: `${name} Update`,
          message: `${name} updated by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push(`${name} updated`);
        importantFieldsChanged = true;
      }
    });

    // 5. Banner Updates
    // Removal
    if (removeBanners.length > 0) {
      updatedProjectBanners = updatedProjectBanners.filter(
        (banner) => !removeBanners.includes(banner.url)
      );
      logs.push({
        actionType: "Banner Removal",
        message: `${removeBanners.length} banner(s) removed by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`${removeBanners.length} banner(s) removed`);
      importantFieldsChanged = true;
    }

    // Addition
    if (files?.projectBanner?.length > 0) {
      if (updatedProjectBanners.length + files.projectBanner.length > 10) {
        throw new ApiError(400, "Maximum 10 banners allowed");
      }

      const uploadPromises = files.projectBanner.map(async (file) => {
        const uniqueName = `${uuidv4()}-${file.originalname}`;
        const url = await uploadToS3(file.buffer, uniqueName, file.mimetype);
        return url ? { url, uploadDate: new Date() } : null;
      });

      const newBanners = (await Promise.all(uploadPromises)).filter(Boolean);
      updatedProjectBanners.push(...newBanners);

      logs.push({
        actionType: "Banner Addition",
        message: `${files.projectBanner.length} banner(s) added by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`${files.projectBanner.length} banner(s) added`);
      importantFieldsChanged = true;
    }

    // 6. Members Update
    if (Array.isArray(members)) {
      const existingMemberIds = existingProject.members.map((m) =>
        m._id.toString()
      );
      const newMemberIds = members
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id).toString());

      if (
        existingMemberIds.length !== newMemberIds.length ||
        !existingMemberIds.every((id) => newMemberIds.includes(id))
      ) {
        membersChanged = true;
        updateData.members = members
          .filter(Boolean)
          .map((id) => new mongoose.Types.ObjectId(id));

        logs.push({
          actionType: "Members Update",
          message: `Project members updated by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push("Project members updated");
        importantFieldsChanged = true;
      }
    }

    // 7. Project Owners Update
    if (Array.isArray(projectOwners)) {
      const existingOwnerIds = existingProject.projectOwners
        .map((o) => o.ownerId?._id.toString())
        .filter(Boolean);
      const newOwnerIds = projectOwners
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id).toString());

      if (
        existingOwnerIds.length !== newOwnerIds.length ||
        !existingOwnerIds.every((id) => newOwnerIds.includes(id))
      ) {
        ownersChanged = true;
        updateData.projectOwners = projectOwners
          .filter(Boolean)
          .map((id) => ({ ownerId: new mongoose.Types.ObjectId(id) }));

        logs.push({
          actionType: "Owners Update",
          message: `Project owners updated by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push("Project owners updated");
        importantFieldsChanged = true;
      }
    }

    // Prepare final update data
    updateData = {
      ...updateData,
      projectName: updatedProjectName,
      description,
      location,
      businessAreas,
      comapanyName,
      status,
      deadline,
      projectBanner: updatedProjectBanners,
      logs: [...(existingProject.logs || []), ...logs],
    };

    // Perform the update with transaction for safety
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const updatedProject = await editProject
        .findByIdAndUpdate(
          projectId,
          { $set: updateData },
          { new: true, session }
        )
        .populate("members", "email userName _id")
        .populate("projectOwners.ownerId", "email userName _id");

      // NOTIFICATION LOGIC
      const notificationPromises = [];
      const emailRecipients = new Set();

      // Helper function to create notifications
      const createNotification = (userId, title, description) => {
        notificationPromises.push(
          ShowNotification.create({
            title,
            type: "Project Update",
            description,
            memberId: userId,
            projectId: existingProject._id,
          })
        );
      };

      // 1. Handle Member Changes
      if (membersChanged) {
        const allMemberIds = [
          ...existingProject.members.map((m) => m._id),
          ...(updateData.members || []),
        ];
        const ownerIds = existingProject.projectOwners
          .map((o) => o.ownerId?._id)
          .filter(Boolean);

        const allRecipients = [...new Set([...allMemberIds, ...ownerIds])];

        allRecipients.forEach((userId) => {
          createNotification(
            userId,
            "Project Members Updated",
            `Members for "${existingProject.projectName}" were updated by ${performingUser.userName}`
          );
          // Add to email list
          const user = [
            ...existingProject.members,
            ...existingProject.projectOwners.map((o) => o.ownerId),
          ].find((u) => u?._id.toString() === userId.toString());
          if (user?.email) emailRecipients.add(user.email);
        });
      }

      // 2. Handle Owner Changes
      if (ownersChanged) {
        const allOwnerIds = [
          ...existingProject.projectOwners.map((o) => o.ownerId?._id),
          ...(updateData.projectOwners?.map((o) => o.ownerId) || []),
        ].filter(Boolean);

        allOwnerIds.forEach((userId) => {
          createNotification(
            userId,
            "Project Owners Updated",
            `Owners for "${existingProject.projectName}" were updated by ${performingUser.userName}`
          );
          // Add to email list
          const user = existingProject.projectOwners
            .map((o) => o.ownerId)
            .find((u) => u?._id.toString() === userId.toString());
          if (user?.email) emailRecipients.add(user.email);
        });
      }

      // 3. Handle Other Important Changes (including business areas)
      if (importantFieldsChanged && changesSummary.length > 0) {
        const allRecipients = [
          ...existingProject.members.map((m) => m._id),
          ...existingProject.projectOwners
            .map((o) => o.ownerId?._id)
            .filter(Boolean),
          performingUser._id, // Always include the performing user
        ].filter(
          (value, index, self) =>
            self.findIndex((v) => v.toString() === value.toString()) === index
        );

        allRecipients.forEach((userId) => {
          createNotification(
            userId,
            "Project Updated",
            `Project "${existingProject.projectName}" was updated: ${changesSummary.join(", ")}`
          );
          // Add to email list
          const user = [
            ...existingProject.members,
            ...existingProject.projectOwners.map((o) => o.ownerId),
            performingUser,
          ].find((u) => u?._id.toString() === userId.toString());
          if (user?.email) emailRecipients.add(user.email);
        });
      }

      // Execute all notifications
      if (notificationPromises.length > 0) {
        await Promise.all(notificationPromises);
      }

      // Commit transaction
      await session.commitTransaction();

      // Send email if there are important changes
      if (importantFieldsChanged && emailRecipients.size > 0) {
        const emailBody = {
          from: process.env.EMAIL_FROM,
          to: Array.from(emailRecipients).join(","),
          subject: `Project Update: ${existingProject.projectName}`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="UTF-8">
              <title>Project Update Notification</title>
            </head>
            <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <tr>
                  <td style="padding: 20px; text-align: left;">
                    <h2 style="color: #333;">Project Update Notification</h2>
                    <p style="font-size: 16px; color: #555;">The following changes were made to project <strong>${existingProject.projectName}</strong>:</p>
                    <ul style="font-size: 16px; color: #555; padding-left: 20px;">
                      ${changesSummary.map((change) => `<li>${change}</li>`).join("")}
                    </ul>
                    <p style="font-size: 16px; color: #555;"><strong>Updated by:</strong> ${performingUser.userName}</p>
                    <p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p>
                    <p style="font-size: 14px; color: #999; margin-top: 30px;">
                      This is an automated notification. Please do not reply to this email.
                    </p>
                  </td>
                </tr>
              </table>
            </body>
            </html>
          `,
        };        

        try {
          await SendEmailUtil(emailBody);
        } catch (emailError) {
          console.error("Failed to send notification email:", emailError);
        }
      }

      res
        .status(200)
        .json(
          new ApiResponse(200, updatedProject, "Project updated successfully")
        );
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error updating project:", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    res.status(statusCode).json({
      message: error.message || "Internal Server Error",
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  }
});

const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, page } = req.query;
    const { isMain, _id: loggedInUserId, businessArea } = req.user;

    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];

    // Base filter for status
    const baseFilter = {
      ...(status && validStatuses.includes(status) ? { status } : {}),
    };

    // For non-main users, filter projects by business area
    let finalFilter = baseFilter;
    if (!isMain) {
      finalFilter = {
        ...baseFilter,
        businessAreas: businessArea
      };
    }

    // Pagination setup
    const pageNumber = page ? parseInt(page, 10) : null;
    const pageSize = 10;
    const skip = pageNumber ? (pageNumber - 1) * pageSize : 0;

    // Main query with population
    let query = editProject.find(finalFilter)
      .sort({ createdAt: -1 })
      .populate([
        {
          path: "members",
          select: "userName avatar role email",
          populate: {
            path: "role",
            select: "roleName",
          },
        },
        {
          path: "projectOwners.ownerId",
          model: "User",
          select: "userName role email",
          populate: {
            path: "role",
            select: "roleName",
          },
        },
      ]);

    // Apply pagination if needed
    if (pageNumber) {
      query = query.skip(skip).limit(pageSize);
    }

    const projects = await query;
    const totalProjects = pageNumber
      ? await editProject.countDocuments(finalFilter)
      : null;

    // Enhanced project processing
    const projectsWithDocuments = await Promise.all(
      projects.map(async (project) => {
        // Check user's relationship to project
        const isMember = project.members.some(id => 
          id._id.toString() === loggedInUserId.toString()
        );
        const isOwner = project.projectOwners.some(owner => 
          owner.ownerId && owner.ownerId._id.toString() === loggedInUserId.toString()
        );

        // Milestones logic
        const milestones = [
          { name: "Project Details", completed: true },
          { name: "Filling", completed: false },
          { name: "Payment", completed: false },
          { name: "Review", completed: false },
          { name: "Completed", completed: false },
        ];

        const isFillingComplete =
          project.description &&
          project.location &&
          project.projectName &&
          project.projectBanner?.length > 0 &&
          project.members?.length > 0;

        if (isFillingComplete) milestones[1].completed = true;

        // Fetch related documents
        const [projectReports, projectDocuments, financeDocuments] = await Promise.all([
          Document.find({ projName: project.projectName }),
          UserDocument.find({ projName: project.projectName }),
          FinanceDocument.find({ projName: project.projectName }),
        ]);

        if (financeDocuments?.length > 0) milestones[2].completed = true;
        if (milestones[1].completed && milestones[2].completed) milestones[3].completed = true;
        if (project.status === "Completed") milestones[4].completed = true;

        // Process documents
        const filteredDocuments = projectDocuments?.map(doc => ({
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
        })) || [];

        const filteredReports = projectReports?.map(report => ({
          fileName: report.fileName,
          fileUrl: report.fileUrl,
          user: report.user,
          status: report.status,
          uploadedAt: report.uploadedAt,
        })) || [];

        const financeDetails = financeDocuments
          ?.map(doc => ({
            id: doc._id,
            fileName: doc.fileName,
            fileUrl: doc.fileUrl,
            user: doc.user,
            financialExecution: doc.financialExecution,
            physicalExecution: doc.physicalExecution,
            uploadedAt: doc.uploadedAt,
            reference: doc.reference,
          }))
          .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)) || [];

        // Additional data
        const latestLog = project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null;
        const additionalMilestones = await AdditionalMilestone.find({
          projectId: project._id,
        }).populate({
          path: "userId",
          model: "User",
          select: "userName",
        });

        return {
          ...project.toObject(),
          documents: filteredDocuments,
          financeDocuments: financeDetails,
          projectReports: filteredReports,
          latestLog,
          milestones,
          additionalMilestones,
          isMember,
          isOwner,
          fromBusinessArea: !isMain && !isMember && !isOwner,
        };
      })
    );

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects: projectsWithDocuments,
          ...(pageNumber && {
            currentPage: pageNumber,
            totalPages: Math.ceil(totalProjects / pageSize),
            totalProjects,
          }),
        },
        "Projects retrieved successfully"
      )
    );
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getProjectById = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const { isMain, _id: loggedInUserId, businessArea } = req.user;

    const project = await editProject.findOne({ _id: projectId }).populate([
      {
        path: "members",
        model: "User",
        select: "userName avatar role userType",
        populate: { path: "role", model: "Role", select: "roleName" },
      },
      {
        path: "projectOwners.ownerId",
        model: "User",
        select: "userName role",
        populate: { path: "role", select: "roleName" },
      },
    ]);

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    if (!isMain) {
      const isMember = project.members.some((member) =>
        member._id.equals(loggedInUserId)
      );
      const isOwner = project.projectOwners.some(
        (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
      );

      const businessAreaMatch =
        typeof project.businessAreas === "string"
          ? project.businessAreas === businessArea
          : project.businessAreas?.includes(businessArea);

      if (!isMember && !isOwner && !businessAreaMatch) {
        throw new ApiError(
          403,
          "You don't have permission to access this project"
        );
      }
    }

    const isMember = project.members.some((member) =>
      member._id.equals(loggedInUserId)
    );
    const isOwner = project.projectOwners.some(
      (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
    );
    const fromBusinessArea = !isMember && !isOwner;

    const milestones = [
      { name: "Project Details", completed: true },
      { name: "Filling", completed: false },
      { name: "Payment", completed: false },
      { name: "Review", completed: false },
      { name: "Completed", completed: false },
    ];

    const isFillingComplete =
      project.description &&
      project.location &&
      project.projectName &&
      project.projectBanner.length > 0 &&
      project.members.length > 0;

    if (isFillingComplete) milestones[1].completed = true;

    const [projectDocuments, projectReports, financeDocuments] =
      await Promise.all([
        UserDocument.find({ projName: project.projectName }),
        Document.find({ projName: project.projectName }),
        FinanceDocument.find({ projName: project.projectName }),
      ]);

    if (financeDocuments.length > 0) milestones[2].completed = true;
    if (milestones[1].completed && milestones[2].completed)
      milestones[3].completed = true;
    if (project.status === "Completed") milestones[4].completed = true;

    const updatedMembers = project.members.map((member) => ({
      userId: member._id,
      _id: member._id,
      userName: member.userName,
      avatar: member.avatar,
      userType: member.userType || "Not Assigned",
    }));

    const updatedProjectOwners = project.projectOwners
      .filter((owner) => owner.ownerId)
      .map((owner) => ({
        ownerId: owner.ownerId._id || owner.ownerId,
        ownerName:
          owner.ownerId.userName || owner.ownerName || owner.userName || "",
        role: owner.ownerId.role ? owner.ownerId.role.roleName : "No Role",
        _id: owner.ownerId._id || owner.ownerId,
        email: owner.ownerId.email || owner.email,
      }));

    const responseData = {
      ...project.toObject(),
      members: updatedMembers,
      projectOwners: updatedProjectOwners,
      documents: projectDocuments.map((doc) => ({
        fileName: doc.fileName,
        fileUrl: doc.fileUrl,
        user: doc.user,
      })),
      financeDocuments: financeDocuments
        .map((doc) => ({
          id: doc._id,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
          financialExecution: doc.financialExecution,
          physicalExecution: doc.physicalExecution,
          uploadedAt: doc.uploadedAt,
          reference: doc.reference,
        }))
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)),
      projectReports: projectReports.map((report) => ({
        fileName: report.fileName,
        fileUrl: report.fileUrl,
        user: report.user,
        status: report.status,
        uploadedAt: report.uploadedAt,
      })),
      latestLog:
        project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null,
      milestones,
      additionalMilestones: await AdditionalMilestone.find({
        projectId: project._id,
      }).populate({
        path: "userId",
        model: "User",
        select: "userName",
      }),
      ...(isMain ? {} : { fromBusinessArea }),
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseData, "Project retrieved successfully")
      );
  } catch (error) {
    throw new ApiError(
      error.statusCode || 400,
      error.message || "Failed to retrieve project"
    );
  }
});

const deleteProject = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { projectId } = req.params;
    const performingUser = req.user; // User who is deleting the project

    // Find and populate the project first to get members/owners for notifications
    const project = await editProject
      .findById(projectId)
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .session(session);

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Get all users who should be notified (members + owners)
    const notificationRecipients = [
      ...project.members.map((m) => m._id),
      ...project.projectOwners.map((o) => o.ownerId?._id).filter(Boolean),
      performingUser._id, // Include the user who deleted the project
    ].filter(
      (v, i, a) => a.findIndex((t) => t.toString() === v.toString()) === i
    ); // Remove duplicates

    // Create notifications for all recipients
    const notificationPromises = notificationRecipients.map((userId) =>
      ShowNotification.create({
        title: "Project Deleted",
        type: "Project Deletion",
        description: `Project "${project.projectName}" was deleted by ${performingUser.userName}`,
        memberId: userId,
        projectId: project._id, // Keep reference even though project is deleted
      })
    );

    // Delete the project
    await editProject.findByIdAndDelete(projectId).session(session);

    // Execute all notification creations
    await Promise.all(notificationPromises);

    // Commit the transaction
    await session.commitTransaction();

    res
      .status(200)
      .json(new ApiResponse(200, project, "Project deleted successfully"));
  } catch (error) {
    // Abort transaction on error
    await session.abortTransaction();

    console.error("Error deleting project:", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    res.status(statusCode).json({
      message: error.message || "Internal Server Error",
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  } finally {
    // End the session
    session.endSession();
  }
});

export {
  createProject,
  editProjects,
  getAllProjects,
  getProjectById,
  deleteProject,
};
