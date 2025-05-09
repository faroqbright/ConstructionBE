import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { editProject } from "../models/project.model.js"; // Your project model
import { User } from "../models/user.model.js"; // Your User model
import { AdditionalMilestone } from "../models/additionalMilestone.js";
import { ShowNotification } from "../models/showNotificationSchema.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js"; // Your S3 uploader
import { SendEmailUtil } from "../utils/emailsender.js";
import UserDocument from "../models/userdocumentModel.js";
import Document from "../models/documentModel.js";
import FinanceDocument from "../models/finance.model.js";
// --- ADDED FOR PUSH NOTIFICATIONS ---
import { sendNotification as sendPushNotification } from "../utils/firebase.service.js";

const createProject = asyncHandler(async (req, res) => {
  try {
    const {
      projectName,
      projectOwners, // Assuming this is an array of User IDs
      description,
      location,
      status,
      businessAreas,
      comapanyName,
      deadline,
      physicalEducationRange,
      financialEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;
    const performingUser = req.user; // Assuming req.user is available

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
      projectOwners: Array.isArray(projectOwners)
        ? projectOwners.map((ownerId) => ({ ownerId }))
        : [], // Ensure projectOwners is structured if needed by schema
      description,
      businessAreas,
      comapanyName,
      location,
      status,
      deadline,
      physicalEducationRange,
      financialEducationRange,
      daysLeft,
      projectBanner: projectBanners,
      createdBy: performingUser?._id, // Optional: track creator
    };

    const project = await editProject.create(projectData);

    // --- PUSH NOTIFICATION LOGIC ---
    if (project) {
      const recipientUserIds = new Set();
      if (Array.isArray(projectOwners)) {
        projectOwners.forEach((ownerId) => {
          if (mongoose.Types.ObjectId.isValid(ownerId)) {
            recipientUserIds.add(ownerId.toString());
          }
        });
      }
      // Optionally notify the creator as well
      // if (performingUser?._id) {
      //   recipientUserIds.add(performingUser._id.toString());
      // }

      if (recipientUserIds.size > 0) {
        try {
          const usersForPush = await User.find({
            _id: { $in: Array.from(recipientUserIds) },
            fcmDeviceToken: { $ne: null, $exists: true, $ne: "" },
          })
            .select("fcmDeviceToken")
            .lean();

          const fcmTokens = usersForPush
            .map((u) => u.fcmDeviceToken)
            .filter(Boolean);

          if (fcmTokens.length > 0) {
            const pushTitle = `New Project Created: ${project.projectName}`;
            const pushBody = `A new project "${project.projectName}" has been created by ${performingUser?.userName || "system"}.`;
            await sendPushNotification(fcmTokens, pushTitle, pushBody, {
              projectId: project._id.toString(),
              type: "PROJECT_CREATED",
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            });
          }
        } catch (pushError) {
          console.error(
            "Failed to send project creation push notifications:",
            pushError
          );
        }
      }
    }
    // --- END PUSH NOTIFICATION LOGIC ---

    res
      .status(201)
      .json(new ApiResponse(201, project, "Project created successfully"));
  } catch (error) {
    console.error("Error in createProject:", error);
    res.status(500).json({ message: error.message || "Internal Server Error" });
  }
});

const editProjects = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Invalid project ID");
    }

    const {
      projectName, // This is the new potential project name from req.body
      projectOwners,
      description,
      location,
      businessAreas,
      comapanyName,
      members,
      status,
      deadline,
      physicalEducationRange,
      financialEducationRange,
      removeBanners = [],
    } = req.body;

    const { files } = req;
    const performingUser = req.user;

    const existingProject = await editProject
      .findById(projectId)
      .populate("projectOwners.ownerId", "email userName _id") // Keep existing populates
      .populate("members", "email userName _id") // Keep existing populates
      .lean();

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

    let finalProjectName = existingProject.projectName; // Use this for notifications if name changes
    if (projectName && projectName !== existingProject.projectName) {
      const nameTaken = await editProject.findOne({
        projectName,
        _id: { $ne: projectId },
      });
      finalProjectName = nameTaken
        ? `${projectName}-${uuidv4().split("-")[0]}`
        : projectName;
      // updateData.projectName will be set later with all other fields
      logs.push({
        actionType: "Project Name Change",
        message: `Project name changed from "${existingProject.projectName}" to "${finalProjectName}" by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`Project name changed to "${finalProjectName}"`);
      importantFieldsChanged = true;
    } else {
      finalProjectName = existingProject.projectName; // No change, use existing
    }

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
    if (deadline !== undefined) {
      // Check if deadline is part of the request body
      let existingDeadlineStr = existingProject.deadline
        ? new Date(existingProject.deadline).toISOString().split("T")[0]
        : null;
      const newDeadlineStr = deadline
        ? new Date(deadline).toISOString().split("T")[0]
        : null;

      if (newDeadlineStr !== existingDeadlineStr) {
        logs.push({
          actionType: "Deadline Change",
          message: `Deadline updated from "${existingDeadlineStr || "N/A"}" to "${newDeadlineStr || "N/A"}" by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push(
          `Deadline updated to "${newDeadlineStr || "cleared"}"`
        );
        importantFieldsChanged = true;
      }
    }

    const fieldUpdates = [
      { key: "description", value: description, name: "Description" },
      { key: "location", value: location, name: "Location" },
      { key: "businessAreas", value: businessAreas, name: "Business Areas" },
      { key: "comapanyName", value: comapanyName, name: "Company Name" },
    ];

    fieldUpdates.forEach(({ key, value, name }) => {
      if (value !== undefined && value !== existingProject[key]) {
        // Check for undefined to allow empty strings
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

    if (files?.projectBanner?.length > 0) {
      if (updatedProjectBanners.length + files.projectBanner.length > 10) {
        throw new ApiError(400, "Maximum 10 banners allowed");
      }
      const uploadPromises = files.projectBanner.map(async (file) => {
        const uniqueFileName = `${uuidv4()}-${file.originalname}`;
        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          uniqueFileName,
          file.mimetype
        );
        return uploadedImageUrl
          ? { url: uploadedImageUrl, uploadDate: new Date() }
          : null;
      });
      const newBanners = (await Promise.all(uploadPromises)).filter(Boolean);
      updatedProjectBanners.push(...newBanners);
      logs.push({
        actionType: "Banner Addition",
        message: `${newBanners.length} new banner(s) added by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`${newBanners.length} new banner(s) added`);
      importantFieldsChanged = true;
    }

    if (Array.isArray(members)) {
      const existingMemberIds = (existingProject.members || []).map((m) =>
        m._id.toString()
      );
      const newMemberIds = members.filter(Boolean).map((id) => {
        if (!mongoose.Types.ObjectId.isValid(id))
          throw new ApiError(400, `Invalid member ID: ${id}`);
        return new mongoose.Types.ObjectId(id).toString();
      });

      const setExisting = new Set(existingMemberIds);
      const setNew = new Set(newMemberIds);

      if (
        setExisting.size !== setNew.size ||
        !existingMemberIds.every((id) => setNew.has(id)) ||
        !newMemberIds.every((id) => setExisting.has(id))
      ) {
        membersChanged = true;
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

    if (Array.isArray(projectOwners)) {
      const existingOwnerIds = (existingProject.projectOwners || [])
        .map((o) => o.ownerId?._id.toString())
        .filter(Boolean);
      const newOwnerIds = projectOwners.filter(Boolean).map((id) => {
        if (!mongoose.Types.ObjectId.isValid(id))
          throw new ApiError(400, `Invalid owner ID: ${id}`);
        return new mongoose.Types.ObjectId(id).toString();
      });

      const setExisting = new Set(existingOwnerIds);
      const setNew = new Set(newOwnerIds);

      if (
        setExisting.size !== setNew.size ||
        !existingOwnerIds.every((id) => setNew.has(id)) ||
        !newOwnerIds.every((id) => setExisting.has(id))
      ) {
        ownersChanged = true;
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

    if (
      physicalEducationRange !== undefined &&
      physicalEducationRange !== existingProject.physicalEducationRange
    ) {
      logs.push({
        actionType: "Physical Education Range Update",
        message: `Physical Education Range updated by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push("Physical Education Range updated");
      importantFieldsChanged = true;
    }
    if (
      financialEducationRange !== undefined &&
      financialEducationRange !== existingProject.financialEducationRange
    ) {
      logs.push({
        actionType: "Financial Education Range Update",
        message: `Financial Education Range updated by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push("Financial Education Range updated");
      importantFieldsChanged = true;
    }

    updateData = {
      projectName: finalProjectName, // Use the potentially suffixed name
      description:
        description !== undefined ? description : existingProject.description,
      location: location !== undefined ? location : existingProject.location,
      businessAreas:
        businessAreas !== undefined
          ? businessAreas
          : existingProject.businessAreas,
      comapanyName:
        comapanyName !== undefined
          ? comapanyName
          : existingProject.comapanyName,
      status: status !== undefined ? status : existingProject.status,
      deadline:
        deadline !== undefined
          ? deadline === "" || deadline === null
            ? null
            : deadline
          : existingProject.deadline, // Handle empty string for clearing deadline
      physicalEducationRange:
        physicalEducationRange !== undefined
          ? physicalEducationRange
          : existingProject.physicalEducationRange,
      financialEducationRange:
        financialEducationRange !== undefined
          ? financialEducationRange
          : existingProject.financialEducationRange,
      projectBanner: updatedProjectBanners,
      logs: [...(existingProject.logs || []), ...logs],
    };
    if (membersChanged && Array.isArray(members)) {
      updateData.members = members
        .filter(Boolean)
        .map((id) => new mongoose.Types.ObjectId(id));
    }
    if (ownersChanged && Array.isArray(projectOwners)) {
      updateData.projectOwners = projectOwners
        .filter(Boolean)
        .map((id) => ({ ownerId: new mongoose.Types.ObjectId(id) }));
    }

    if (Object.keys(logs).length === 0) {
      return res
        .status(200)
        .json(
          new ApiResponse(
            200,
            existingProject,
            "No changes detected. Project remains the same."
          )
        );
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    let updatedProject;

    try {
      updatedProject = await editProject
        .findByIdAndUpdate(
          projectId,
          { $set: updateData },
          { new: true, session }
        )
        .populate("members", "email userName _id")
        .populate("projectOwners.ownerId", "email userName _id");

      if (!updatedProject) {
        throw new ApiError(500, "Failed to update project after changes.");
      }

      const notificationPromises = [];
      const emailRecipients = new Set();

      const createNotification = (userId, title, descriptionForInApp) => {
        // Renamed description to avoid clash
        notificationPromises.push(
          ShowNotification.create(
            [
              {
                title: `Project Update: "${updatedProject.projectName}"`,
                type: "Project Update",
                description: descriptionForInApp, // Use specific description for in-app
                memberId: userId,
                projectId: updatedProject._id,
              },
            ],
            { session }
          )
        );
      };

      const pushNotificationUserIds = new Set();

      if (importantFieldsChanged || membersChanged || ownersChanged) {
        updatedProject.members?.forEach((member) => {
          if (member?._id) pushNotificationUserIds.add(member._id.toString());
          if (member?.email) emailRecipients.add(member.email);
        });
        updatedProject.projectOwners?.forEach((ownerObj) => {
          if (ownerObj?.ownerId?._id)
            pushNotificationUserIds.add(ownerObj.ownerId._id.toString());
          if (ownerObj?.ownerId?.email)
            emailRecipients.add(ownerObj.ownerId.email);
        });
        if (performingUser?._id)
          pushNotificationUserIds.add(performingUser._id.toString());
        if (performingUser?.email) emailRecipients.add(performingUser.email);

        const allInvolvedUserIdsForInApp = new Set();
        if (membersChanged) {
          const oldMemberIds = (existingProject.members || [])
            .map((m) => m._id?.toString())
            .filter(Boolean);
          const newMemberIds = (updatedProject.members || [])
            .map((m) => m._id?.toString())
            .filter(Boolean);
          [...oldMemberIds, ...newMemberIds].forEach((id) =>
            allInvolvedUserIdsForInApp.add(id)
          );
        }
        if (ownersChanged) {
          const oldOwnerIds = (existingProject.projectOwners || [])
            .map((o) => o.ownerId?._id?.toString())
            .filter(Boolean);
          const newOwnerIds = (updatedProject.projectOwners || [])
            .map((o) => o.ownerId?._id?.toString())
            .filter(Boolean);
          [...oldOwnerIds, ...newOwnerIds].forEach((id) =>
            allInvolvedUserIdsForInApp.add(id)
          );
        }
        // For general important field changes, notify current members and owners
        if (importantFieldsChanged && changesSummary.length > 0) {
          (updatedProject.members || []).forEach((m) =>
            allInvolvedUserIdsForInApp.add(m._id?.toString())
          );
          (updatedProject.projectOwners || []).forEach((o) =>
            allInvolvedUserIdsForInApp.add(o.ownerId?._id?.toString())
          );
        }
        // Always notify the performing user if there were changes
        if (changesSummary.length > 0 && performingUser?._id) {
          allInvolvedUserIdsForInApp.add(performingUser._id?.toString());
        }

        const inAppNotificationMessage = `Project "${updatedProject.projectName}" updated by ${performingUser.userName}: ${changesSummary.join(", ")}.`;
        allInvolvedUserIdsForInApp.forEach((userIdStr) => {
          if (userIdStr) {
            createNotification(
              new mongoose.Types.ObjectId(userIdStr),
              `Project Update: "${updatedProject.projectName}"`,
              inAppNotificationMessage
            );
          }
        });
      }

      if (notificationPromises.length > 0) {
        await Promise.all(notificationPromises);
      }

      await session.commitTransaction();

      // --- PUSH NOTIFICATION LOGIC (after commit) ---
      if (pushNotificationUserIds.size > 0 && changesSummary.length > 0) {
        try {
          const usersForPush = await User.find({
            _id: {
              $in: Array.from(pushNotificationUserIds).map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            },
            fcmDeviceToken: { $ne: null, $exists: true, $ne: "" },
          })
            .select("fcmDeviceToken")
            .lean();

          const fcmTokens = usersForPush
            .map((u) => u.fcmDeviceToken)
            .filter(Boolean);

          if (fcmTokens.length > 0) {
            const pushTitle = `Project Update: ${updatedProject.projectName}`;
            const pushBody = `Project "${updatedProject.projectName}" updated by ${performingUser.userName}: ${changesSummary.join(", ")}.`;
            await sendPushNotification(fcmTokens, pushTitle, pushBody, {
              projectId: updatedProject._id.toString(),
              type: "PROJECT_UPDATE",
              click_action: "FLUTTER_NOTIFICATION_CLICK",
            });
          }
        } catch (pushError) {
          console.error(
            "Failed to send project update push notifications:",
            pushError
          );
        }
      }
      // --- END PUSH NOTIFICATION LOGIC ---

      if (
        (importantFieldsChanged || membersChanged || ownersChanged) &&
        emailRecipients.size > 0 &&
        changesSummary.length > 0
      ) {
        const emailBody = {
          from: process.env.EMAIL_FROM || "noreply@example.com", // Fallback if EMAIL_FROM is not set
          to: Array.from(emailRecipients).join(","),
          subject: `Project Update: ${updatedProject.projectName}`,
          html: `
            <!DOCTYPE html>
            <html lang="en">
            <head><meta charset="UTF-8"><title>Project Update Notification</title></head>
            <body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);">
                <tr><td style="padding: 20px; text-align: left;">
                    <h2 style="color: #333;">Project Update Notification</h2>
                    <p style="font-size: 16px; color: #555;">The project <strong>${updatedProject.projectName}</strong> has been updated by ${performingUser.userName}.</p>
                    <p style="font-size: 16px; color: #555;">Changes:</p>
                    <ul style="font-size: 16px; color: #555; padding-left: 20px;">
                      ${changesSummary.map((change) => `<li>${change}</li>`).join("")}
                    </ul>
                    <p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p>
                    <p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification. Please do not reply to this email.</p>
                </td></tr>
              </table>
            </body></html>`,
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
    const { status, page, milestoneUserIds } = req.query;
    const { isMain, _id: loggedInUserId } = req.user;
    const assignedBusinessAreas = req.user.assignedBusinessAreas || [];
    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];
    const baseFilter = {
      ...(status && validStatuses.includes(status) ? { status } : {}),
    };
    const userBusinessAreas =
      assignedBusinessAreas.length > 0
        ? assignedBusinessAreas.map((area) => area.businessArea)
        : [];
    let finalFilter = baseFilter;
    if (!isMain) {
      finalFilter = {
        ...baseFilter,
        $or: [
          { members: loggedInUserId },
          { "projectOwners.ownerId": loggedInUserId },
          ...(userBusinessAreas.length > 0
            ? [{ businessAreas: { $in: userBusinessAreas } }]
            : []),
        ],
      };
    }
    const pageNumber = page ? Number.parseInt(page, 10) : 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;
    const totalProjects = await editProject.countDocuments(finalFilter);
    let query = editProject
      .find(finalFilter)
      .populate([
        {
          path: "members",
          select: "userName avatar role",
          populate: { path: "role", select: "roleName" },
        },
        {
          path: "projectOwners.ownerId",
          select: "userName role",
          populate: { path: "role", select: "roleName" },
        },
      ])
      .sort({ createdAt: -1 });
    if (pageNumber > 0) {
      query = query.skip(skip).limit(pageSize);
    }
    const projects = await query;
    let filteredProjects = projects;
    if (milestoneUserIds) {
      try {
        const parsedMilestoneUserIds = JSON.parse(milestoneUserIds);
        if (
          Array.isArray(parsedMilestoneUserIds) &&
          parsedMilestoneUserIds.length > 0
        ) {
          const userIds = parsedMilestoneUserIds.filter((id) =>
            mongoose.Types.ObjectId.isValid(id)
          );
          if (userIds.length > 0) {
            const projectIds = projects.map((project) => project._id);
            const allMilestones = await AdditionalMilestone.find({
              projectId: { $in: projectIds },
            }).populate({
              path: "userId",
              model: "User",
              select: "userName _id",
            });
            const projectMilestonesMap = {};
            allMilestones.forEach((milestone) => {
              const projectId = milestone.projectId.toString();
              if (!projectMilestonesMap[projectId])
                projectMilestonesMap[projectId] = [];
              projectMilestonesMap[projectId].push(milestone);
            });
            filteredProjects = projects.filter((project) => {
              const projectId = project._id.toString();
              const milestones = projectMilestonesMap[projectId] || [];
              return milestones.some(
                (milestone) =>
                  milestone.userId &&
                  userIds.includes(milestone.userId._id.toString())
              );
            });
          }
        }
      } catch (parseError) {
        console.error("Error parsing milestoneUserIds:", parseError);
        // Potentially throw an ApiError or handle as a bad request
      }
    }
    const projectsWithDetails = await Promise.all(
      filteredProjects.map(async (project) => {
        const isMember = project.members.some((member) =>
          member._id.equals(loggedInUserId)
        );
        const isOwner = project.projectOwners.some(
          (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
        );
        const fromBusinessArea =
          !isMember &&
          !isOwner &&
          (typeof project.businessAreas === "string"
            ? userBusinessAreas.includes(project.businessAreas)
            : project.businessAreas?.some((area) =>
                userBusinessAreas.includes(area)
              ));
        return {
          ...project.toObject(),
          accessType: { isMember, isOwner, fromBusinessArea },
        };
      })
    );
    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {
            projects: projectsWithDetails,
            pagination: {
              currentPage: pageNumber,
              totalPages: Math.ceil(totalProjects / pageSize),
              totalProjects,
            },
          },
          "Projects retrieved successfully"
        )
      );
  } catch (error) {
    console.error("Error in getAllProjects:", error);
    throw new ApiError(400, error.message);
  }
});

const getProjectById = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const { isMain, _id: loggedInUserId } = req.user;
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
        select: "userName role email",
        populate: { path: "role", select: "roleName" },
      },
    ]);
    if (!project) throw new ApiError(404, "Project not found");

    if (!isMain) {
      const isMember = project.members.some((member) =>
        member._id.equals(loggedInUserId)
      );
      const isOwner = project.projectOwners.some(
        (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
      );

      const projectBusinessAreasArray = Array.isArray(project.businessAreas)
        ? project.businessAreas
        : project.businessAreas
          ? [project.businessAreas]
          : [];

      const userAssignedBusinessAreasArray = Array.isArray(
        req.user.assignedBusinessAreas
      )
        ? req.user.assignedBusinessAreas.map((ba) => ba.businessArea)
        : req.user.businessArea
          ? [req.user.businessArea]
          : []; // Assuming req.user.businessArea if assignedBusinessAreas is not present

      const businessAreaMatch = projectBusinessAreasArray.some((pba) =>
        userAssignedBusinessAreasArray.includes(pba)
      );

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
      project.projectBanner?.length > 0 &&
      project.members?.length > 0;
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
        ownerId: owner.ownerId._id,
        ownerName: owner.ownerId.userName || "",
        role: owner.ownerId.role ? owner.ownerId.role.roleName : "No Role",
        _id: owner.ownerId._id,
        email: owner.ownerId.email || "",
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
        project.logs?.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        )[0] || null, // Ensure proper date comparison for logs
      milestones,
      additionalMilestones: await AdditionalMilestone.find({
        projectId: project._id,
      }).populate({ path: "userId", model: "User", select: "userName" }),
      ...(isMain ? {} : { fromBusinessArea }),
    };
    res
      .status(200)
      .json(
        new ApiResponse(200, responseData, "Project retrieved successfully")
      );
  } catch (error) {
    console.error("Error in getProjectById:", error);
    throw new ApiError(
      error.statusCode || 400,
      error.message || "Failed to retrieve project"
    );
  }
});

const deleteProject = asyncHandler(async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  let projectToDelete;

  try {
    const { projectId } = req.params;
    const performingUser = req.user;

    projectToDelete = await editProject
      .findById(projectId)
      .populate("projectOwners.ownerId", "email userName _id")
      .populate("members", "email userName _id")
      .session(session)
      .lean();

    if (!projectToDelete) {
      await session.abortTransaction();
      session.endSession();
      throw new ApiError(404, "Project not found");
    }

    const deletedProjectName = projectToDelete.projectName;

    const pushNotificationUserIds = new Set();
    projectToDelete.members?.forEach((m) => {
      if (m?._id) pushNotificationUserIds.add(m._id.toString());
    });
    projectToDelete.projectOwners?.forEach((o) => {
      if (o?.ownerId?._id)
        pushNotificationUserIds.add(o.ownerId._id.toString());
    });
    if (performingUser?._id)
      pushNotificationUserIds.add(performingUser._id.toString());

    const notificationRecipientsForInApp = new Set();
    projectToDelete.members?.forEach((m) => {
      if (m?._id) notificationRecipientsForInApp.add(m._id.toString());
    });
    projectToDelete.projectOwners?.forEach((o) => {
      if (o?.ownerId?._id)
        notificationRecipientsForInApp.add(o.ownerId._id.toString());
    });
    if (performingUser?._id)
      notificationRecipientsForInApp.add(performingUser._id.toString());

    const inAppNotificationDescription = `Project "${deletedProjectName}" was deleted by ${performingUser.userName}.`;
    const notificationPromises = Array.from(notificationRecipientsForInApp).map(
      (userIdStr) =>
        ShowNotification.create(
          [
            {
              title: `Project Deleted: ${deletedProjectName}`,
              type: "Project Deletion",
              description: inAppNotificationDescription,
              memberId: new mongoose.Types.ObjectId(userIdStr),
              projectId: projectToDelete._id, // Keep project ID reference even if project is deleted
            },
          ],
          { session }
        )
    );

    const deletionResult = await editProject
      .findByIdAndDelete(projectId)
      .session(session);
    if (!deletionResult) {
      await session.abortTransaction();
      session.endSession();
      throw new ApiError(
        404,
        "Project not found or already deleted during operation."
      );
    }

    if (notificationPromises.length > 0) {
      await Promise.all(notificationPromises);
    }

    await session.commitTransaction();

    // --- PUSH NOTIFICATION LOGIC (after commit) ---
    if (pushNotificationUserIds.size > 0) {
      try {
        const usersForPush = await User.find({
          _id: {
            $in: Array.from(pushNotificationUserIds).map(
              (id) => new mongoose.Types.ObjectId(id)
            ),
          },
          fcmDeviceToken: { $ne: null, $exists: true, $ne: "" },
        })
          .select("fcmDeviceToken")
          .lean();

        const fcmTokens = usersForPush
          .map((u) => u.fcmDeviceToken)
          .filter(Boolean);

        if (fcmTokens.length > 0) {
          const pushTitle = `Project Deleted: ${deletedProjectName}`;
          const pushBody = `The project "${deletedProjectName}" was deleted by ${performingUser.userName}.`;
          await sendPushNotification(fcmTokens, pushTitle, pushBody, {
            deletedProjectId: projectToDelete._id.toString(),
            type: "PROJECT_DELETED",
            click_action: "FLUTTER_NOTIFICATION_CLICK",
          });
        }
      } catch (pushError) {
        console.error(
          "Failed to send project deletion push notifications:",
          pushError
        );
      }
    }
    // --- END PUSH NOTIFICATION LOGIC ---

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          {
            deletedProjectId: projectToDelete._id,
            projectName: deletedProjectName,
          },
          "Project deleted successfully"
        )
      );
  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting project:", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    res.status(statusCode).json({
      message: error.message || "Internal Server Error",
      ...(process.env.NODE_ENV === "development" && { stack: error.stack }),
    });
  } finally {
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
