import {
  parse as parseDateFns,
  isValid as isValidDateFns,
  format as formatDateFns,
} from "date-fns"; // Import from date-fns
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

const toSafeISODateString = (
  dateInput,
  placeholderIfNullOrUndefined = null
) => {
  if (dateInput === null || dateInput === undefined) {
    return placeholderIfNullOrUndefined;
  }
  if (dateInput === "") {
    return null;
  }
  // Check if it's already a Date object and valid
  if (dateInput instanceof Date && isValidDateFns(dateInput)) {
    return formatDateFns(dateInput, "yyyy-MM-dd");
  }
  // Try to parse if it's a string
  const date = new Date(dateInput); // General parsing for ISO or YYYY-MM-DD
  if (date instanceof Date && isValidDateFns(date)) {
    return formatDateFns(date, "yyyy-MM-dd");
  }
  return typeof dateInput === "string"
    ? `Invalid Date Input: ${dateInput}`
    : "Invalid Date Input";
};

const editProjects = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const performingUser = req.user;

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
      throw new ApiError(400, "Invalid project ID format.");
    }

    const {
      projectName: newProjectNameInput,
      projectOwners: newProjectOwnerIdsInput,
      description: newDescriptionInput,
      location: newLocationInput,
      businessAreas: newBusinessAreasInput,
      comapanyName: newCompanyNameInput,
      members: newMemberIdsInput,
      status: newStatusInput,
      deadline: newDeadlineInput, // THIS IS THE FIELD WE ARE FOCUSING ON
      physicalEducationRange: newPhysicalEducationRangeInput,
      financialEducationRange: newFinancialEducationRangeInput,
      removeBanners = [],
    } = req.body;

    const { files } = req;

    const existingProject = await editProject
      .findById(projectId)
      .populate(
        "projectOwners.ownerId",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .populate(
        "members",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .lean();

    if (!existingProject) {
      throw new ApiError(404, "Project not found.");
    }

    const updateData = {};
    const logs = [];
    let updatedProjectBanners = [...(existingProject.projectBanner || [])];
    const changesSummary = [];
    let importantFieldsChanged = false;
    let membersListChanged = false;
    let ownersListChanged = false;

    let finalProjectName = existingProject.projectName;
    if (
      newProjectNameInput &&
      newProjectNameInput !== existingProject.projectName
    ) {
      const nameTaken = await editProject.findOne({
        projectName: newProjectNameInput,
        _id: { $ne: projectId },
      });
      if (nameTaken) {
        finalProjectName = `${newProjectNameInput}-${uuidv4().split("-")[0]}`;
        logs.push({
          actionType: "Project Name Change (Auto-Adjusted)",
          message: `Project name "${newProjectNameInput}" was taken, changed to "${finalProjectName}" by ${performingUser.userName}. Original: "${existingProject.projectName}"`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
      } else {
        finalProjectName = newProjectNameInput;
        logs.push({
          actionType: "Project Name Change",
          message: `Project name changed from "${existingProject.projectName}" to "${finalProjectName}" by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
      }
      updateData.projectName = finalProjectName;
      changesSummary.push(`Project name changed to "${finalProjectName}"`);
      importantFieldsChanged = true;
    }

    if (newStatusInput && newStatusInput !== existingProject.status) {
      updateData.status = newStatusInput;
      logs.push({
        actionType: "Status Update",
        message: `Status changed from "${existingProject.status}" to "${newStatusInput}" by ${performingUser.userName}`,
        userId: performingUser._id,
        timestamp: new Date(),
      });
      changesSummary.push(`Status updated to "${newStatusInput}"`);
      importantFieldsChanged = true;
    }

    // --- MODIFIED DEADLINE HANDLING ---
    if (newDeadlineInput !== undefined) {
      let newDeadlineForDb = null;
      if (newDeadlineInput === "" || newDeadlineInput === null) {
        newDeadlineForDb = null; // Clear the deadline
      } else if (typeof newDeadlineInput === "string") {
        if (newDeadlineInput.includes(" - ")) {
          // Date Range "DD/MM/YYYY - DD/MM/YYYY"
          const dates = newDeadlineInput.split(" - ");
          const startDateString = dates[0]; // e.g., "18/04/2025"

          // Parse DD/MM/YYYY using date-fns
          const parsedStartDate = parseDateFns(
            startDateString,
            "dd/MM/yyyy",
            new Date()
          );

          if (!isValidDateFns(parsedStartDate)) {
            throw new ApiError(
              400,
              `Invalid start date format in range for deadline: '${startDateString}'. Please use DD/MM/YYYY format.`
            );
          }
          newDeadlineForDb = parsedStartDate; // Storing the start date of the range
        } else {
          // Assume it's a single date string, try to parse (e.g. YYYY-MM-DD or ISO)
          const parsedDate = parseDateFns(
            newDeadlineInput,
            "yyyy-MM-dd",
            new Date()
          ); // Try YYYY-MM-DD first
          if (isValidDateFns(parsedDate)) {
            newDeadlineForDb = parsedDate;
          } else {
            // Try general ISO parsing as a fallback
            const generalParsedDate = new Date(newDeadlineInput);
            if (isValidDateFns(generalParsedDate)) {
              newDeadlineForDb = generalParsedDate;
            } else {
              throw new ApiError(
                400,
                `Invalid date format for deadline: '${newDeadlineInput}'. Please use YYYY-MM-DD, a full ISO date string, a 'DD/MM/YYYY - DD/MM/YYYY' range, or null/empty to clear.`
              );
            }
          }
        }
      } else {
        // If newDeadlineInput is not a string (e.g. already a Date object, though unlikely from req.body)
        const dateObj = new Date(newDeadlineInput);
        if (isValidDateFns(dateObj)) {
          newDeadlineForDb = dateObj;
        } else {
          throw new ApiError(
            400,
            `Unsupported deadline input type or invalid date.`
          );
        }
      }

      const existingDeadlineFormatted = toSafeISODateString(
        existingProject.deadline
      );
      const newDeadlineFormatted = toSafeISODateString(newDeadlineForDb);

      if (newDeadlineFormatted !== existingDeadlineFormatted) {
        updateData.deadline = newDeadlineForDb; // newDeadlineForDb is now a Date object or null
        logs.push({
          actionType: "Deadline Change",
          message: `Deadline updated from "${existingDeadlineFormatted || "N/A"}" to "${newDeadlineFormatted || "cleared"}" by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push(
          `Deadline updated to "${newDeadlineFormatted || "cleared"}"`
        );
        importantFieldsChanged = true;
      }
    }
    // --- END MODIFIED DEADLINE HANDLING ---

    const simpleFieldUpdates = [
      {
        key: "description",
        newValue: newDescriptionInput,
        name: "Description",
      },
      { key: "location", newValue: newLocationInput, name: "Location" },
      {
        key: "businessAreas",
        newValue: newBusinessAreasInput,
        name: "Business Areas",
      },
      {
        key: "comapanyName",
        newValue: newCompanyNameInput,
        name: "Company Name",
      },
      {
        key: "physicalEducationRange",
        newValue: newPhysicalEducationRangeInput,
        name: "Physical Education Range",
      },
      {
        key: "financialEducationRange",
        newValue: newFinancialEducationRangeInput,
        name: "Financial Education Range",
      },
    ];

    simpleFieldUpdates.forEach(({ key, newValue, name }) => {
      if (newValue !== undefined && newValue !== existingProject[key]) {
        updateData[key] = newValue;
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

    if (Array.isArray(newMemberIdsInput)) {
      const validatedNewMemberIds = newMemberIdsInput
        .filter(Boolean)
        .map((id) => {
          if (!mongoose.Types.ObjectId.isValid(id))
            throw new ApiError(400, `Invalid member ID format: ${id}`);
          return id.toString();
        });
      const existingMemberIds = (existingProject.members || []).map((m) =>
        m._id.toString()
      );
      if (
        JSON.stringify(validatedNewMemberIds.sort()) !==
        JSON.stringify(existingMemberIds.sort())
      ) {
        updateData.members = validatedNewMemberIds.map(
          (id) => new mongoose.Types.ObjectId(id)
        );
        membersListChanged = true;
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

    if (Array.isArray(newProjectOwnerIdsInput)) {
      const validatedNewOwnerIds = newProjectOwnerIdsInput
        .filter(Boolean)
        .map((id) => {
          if (!mongoose.Types.ObjectId.isValid(id))
            throw new ApiError(400, `Invalid project owner ID format: ${id}`);
          return id.toString();
        });
      const existingOwnerIds = (existingProject.projectOwners || [])
        .map((o) => o.ownerId?._id.toString())
        .filter(Boolean);
      if (
        JSON.stringify(validatedNewOwnerIds.sort()) !==
        JSON.stringify(existingOwnerIds.sort())
      ) {
        updateData.projectOwners = validatedNewOwnerIds.map((id) => ({
          ownerId: new mongoose.Types.ObjectId(id),
        }));
        ownersListChanged = true;
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

    if (Array.isArray(removeBanners) && removeBanners.length > 0) {
      const initialBannerCount = updatedProjectBanners.length;
      updatedProjectBanners = updatedProjectBanners.filter(
        (banner) => !removeBanners.includes(banner.url)
      );
      if (updatedProjectBanners.length < initialBannerCount) {
        updateData.projectBanner = updatedProjectBanners;
        logs.push({
          actionType: "Banner Removal",
          message: `${initialBannerCount - updatedProjectBanners.length} banner(s) removed by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push(
          `${initialBannerCount - updatedProjectBanners.length} banner(s) removed`
        );
        importantFieldsChanged = true;
      }
    }

    if (files?.projectBanner?.length > 0) {
      if (updatedProjectBanners.length + files.projectBanner.length > 10) {
        throw new ApiError(
          400,
          "Cannot upload new banners. Maximum 10 banners allowed in total."
        );
      }
      const uploadPromises = files.projectBanner.map(async (file) => {
        const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
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
      if (newBanners.length > 0) {
        updatedProjectBanners.push(...newBanners);
        updateData.projectBanner = updatedProjectBanners;
        logs.push({
          actionType: "Banner Addition",
          message: `${newBanners.length} new banner(s) added by ${performingUser.userName}`,
          userId: performingUser._id,
          timestamp: new Date(),
        });
        changesSummary.push(`${newBanners.length} new banner(s) added`);
        importantFieldsChanged = true;
      }
    }

    if (
      updateData.projectBanner === undefined &&
      JSON.stringify(updatedProjectBanners) !==
        JSON.stringify(existingProject.projectBanner || [])
    ) {
      updateData.projectBanner = updatedProjectBanners;
    }

    if (Object.keys(updateData).length === 0) {
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

    if (logs.length > 0) {
      updateData.logs = [...(existingProject.logs || []), ...logs];
    }

    const session = await mongoose.startSession();
    session.startTransaction();
    let updatedProject;

    try {
      updatedProject = await editProject
        .findByIdAndUpdate(
          projectId,
          { $set: updateData },
          { new: true, session, runValidators: true }
        )
        .populate(
          "projectOwners.ownerId",
          "email userName _id notificationToken fcmDeviceToken"
        )
        .populate(
          "members",
          "email userName _id notificationToken fcmDeviceToken"
        );

      if (!updatedProject) {
        throw new ApiError(
          500,
          "Failed to update project after changes. Project might have been deleted concurrently."
        );
      }

      const inAppNotificationsToCreate = [];
      if (importantFieldsChanged || membersListChanged || ownersListChanged) {
        const involvedUserIdsForInApp = new Set();
        (updatedProject.members || []).forEach(
          (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
        );
        (updatedProject.projectOwners || []).forEach(
          (o) =>
            o?.ownerId?._id &&
            involvedUserIdsForInApp.add(o.ownerId._id.toString())
        );
        if (membersListChanged)
          (existingProject.members || []).forEach(
            (m) => m?._id && involvedUserIdsForInApp.add(m._id.toString())
          );
        if (ownersListChanged)
          (existingProject.projectOwners || []).forEach(
            (o) =>
              o?.ownerId?._id &&
              involvedUserIdsForInApp.add(o.ownerId._id.toString())
          );
        if (performingUser?._id)
          involvedUserIdsForInApp.add(performingUser._id.toString());

        if (changesSummary.length > 0 && involvedUserIdsForInApp.size > 0) {
          const inAppNotificationMessage = `Project "${updatedProject.projectName}" was updated by ${performingUser.userName}: ${changesSummary.join("; ")}.`;
          Array.from(involvedUserIdsForInApp).forEach((userIdStr) => {
            inAppNotificationsToCreate.push({
              title: `Project Update: ${updatedProject.projectName}`,
              type: "Project Update",
              description: inAppNotificationMessage,
              lengthyDesc: `Details of project update for "${updatedProject.projectName}": ${changesSummary.join("; ")}. Performed by ${performingUser.userName}.`,
              memberId: new mongoose.Types.ObjectId(userIdStr),
              projectId: updatedProject._id,
            });
          });
        }
      }

      if (inAppNotificationsToCreate.length > 0) {
        await ShowNotification.create(inAppNotificationsToCreate, {
          session,
          ordered: true,
        });
      }

      await session.commitTransaction();

      if (
        (importantFieldsChanged || membersListChanged || ownersListChanged) &&
        changesSummary.length > 0
      ) {
        const notificationRecipients = new Map();
        (updatedProject.members || []).forEach(
          (user) =>
            user?._id && notificationRecipients.set(user._id.toString(), user)
        );
        (updatedProject.projectOwners || []).forEach(
          (ownerObj) =>
            ownerObj?.ownerId?._id &&
            notificationRecipients.set(
              ownerObj.ownerId._id.toString(),
              ownerObj.ownerId
            )
        );
        if (membersListChanged)
          (existingProject.members || []).forEach(
            (user) =>
              user?._id &&
              !notificationRecipients.has(user._id.toString()) &&
              notificationRecipients.set(user._id.toString(), user)
          );
        if (ownersListChanged)
          (existingProject.projectOwners || []).forEach(
            (ownerObj) =>
              ownerObj?.ownerId?._id &&
              !notificationRecipients.has(ownerObj.ownerId._id.toString()) &&
              notificationRecipients.set(
                ownerObj.ownerId._id.toString(),
                ownerObj.ownerId
              )
          );

        if (
          performingUser?._id &&
          !notificationRecipients.has(performingUser._id.toString())
        ) {
          const performerDetails = await User.findById(performingUser._id)
            .select("email userName notificationToken fcmDeviceToken")
            .lean();
          if (performerDetails)
            notificationRecipients.set(
              performerDetails._id.toString(),
              performerDetails
            );
        }

        const usersToNotify = Array.from(notificationRecipients.values());
        const fcmTokens = usersToNotify
          .map((u) => u.fcmDeviceToken || u.notificationToken)
          .filter(Boolean);

        if (fcmTokens.length > 0) {
          const pushTitle = `Project Update: ${updatedProject.projectName}`;
          const pushBody = `${changesSummary.join("; ")}. By ${performingUser.userName}.`;
          try {
            await sendPushNotification(fcmTokens, pushTitle, pushBody, {
              projectId: updatedProject._id.toString(),
              type: "PROJECT_UPDATE",
            });
          } catch (pushError) {
            console.error(
              `Failed to send project update push notifications for project ${updatedProject._id}:`,
              pushError.message
            );
          }
        }

        if (usersToNotify.some((u) => u.email)) {
          const emailHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Project Update Notification</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;"><h2 style="color: #333;">Project Update Notification</h2><p style="font-size: 16px; color: #555;">The project <strong>${updatedProject.projectName}</strong> has been updated by ${performingUser.userName}.</p><p style="font-size: 16px; color: #555;">Summary of changes:</p><ul style="font-size: 16px; color: #555; padding-left: 20px;">${changesSummary.map((change) => `<li>${change}</li>`).join("")}</ul><p style="font-size: 16px; color: #555;">Please log in to view the complete details.</p><p style="font-size: 14px; color: #999; margin-top: 30px;">This is an automated notification.</p></td></tr></table></body></html>`;
          for (const user of usersToNotify) {
            if (user.email) {
              try {
                await SendEmailUtil({
                  from: process.env.EMAIL_FROM || "noreply@example.com",
                  to: user.email,
                  subject: `Project Update: ${updatedProject.projectName}`,
                  html: emailHtml,
                });
              } catch (emailError) {
                console.error(
                  `Failed to send project update email to ${user.email} for project ${updatedProject._id}:`,
                  emailError.message
                );
              }
            }
          }
        }
      }
      res
        .status(200)
        .json(
          new ApiResponse(200, updatedProject, "Project updated successfully.")
        );
    } catch (errorInTransaction) {
      await session.abortTransaction();
      console.error(
        "Error during project update transaction (FULL ERROR OBJECT):",
        errorInTransaction
      );
      if (errorInTransaction instanceof ApiError) throw errorInTransaction;
      throw new ApiError(
        500,
        "An error occurred while saving project changes.",
        errorInTransaction.errors || [],
        errorInTransaction.stack
      );
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error(
      "Error in editProjects controller (FULL ERROR OBJECT):",
      error
    );
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : "An internal server error occurred during project update.";
    const errors =
      error instanceof ApiError
        ? error.errors
        : error.errors
          ? error.errors
          : [];
    res
      .status(statusCode)
      .json(new ApiResponse(statusCode, null, message, errors));
  }
});

// Export editProjects along with your other controller functions
// Ensure other functions (createProject, getAllProjects, etc.) are also using robust error handling and validation.
// The following are placeholders from your previous code, ensure they are complete and robust as well.

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
      financialEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;
    const performingUser = req.user;

    const existingProjectCheck = await editProject.findOne({ projectName });
    if (existingProjectCheck) {
      throw new ApiError(400, "Project name already taken.");
    }

    let validatedDeadline = null;
    if (deadline !== undefined) {
      // Check if deadline key was present
      if (deadline === "" || deadline === null) {
        validatedDeadline = null;
      } else if (typeof deadline === "string") {
        if (deadline.includes(" - ")) {
          // Date Range "DD/MM/YYYY - DD/MM/YYYY"
          const dates = deadline.split(" - ");
          const startDateString = dates[0];
          const parsedStartDate = parseDateFns(
            startDateString,
            "dd/MM/yyyy",
            new Date()
          );
          if (!isValidDateFns(parsedStartDate)) {
            throw new ApiError(
              400,
              `Invalid start date format in range for deadline: '${startDateString}'. Please use DD/MM/YYYY format.`
            );
          }
          validatedDeadline = parsedStartDate;
        } else {
          // Assume it's a single date string
          const parsedDate = parseDateFns(deadline, "yyyy-MM-dd", new Date());
          if (isValidDateFns(parsedDate)) {
            validatedDeadline = parsedDate;
          } else {
            const generalParsedDate = new Date(deadline);
            if (isValidDateFns(generalParsedDate)) {
              validatedDeadline = generalParsedDate;
            } else {
              throw new ApiError(
                400,
                `Invalid date format for deadline: '${deadline}'. Please use YYYY-MM-DD, a full ISO date string, a 'DD/MM/YYYY - DD/MM/YYYY' range, or null/empty to clear.`
              );
            }
          }
        }
      } else {
        const dateObj = new Date(deadline);
        if (isValidDateFns(dateObj)) {
          validatedDeadline = dateObj;
        } else {
          throw new ApiError(
            400,
            `Unsupported deadline input type or invalid date.`
          );
        }
      }
    }

    const validatedProjectOwners = [];
    if (Array.isArray(projectOwners)) {
      projectOwners.forEach((ownerId) => {
        if (
          typeof ownerId === "string" &&
          mongoose.Types.ObjectId.isValid(ownerId)
        ) {
          validatedProjectOwners.push({
            ownerId: new mongoose.Types.ObjectId(ownerId),
          });
        } else if (
          typeof ownerId === "object" &&
          ownerId.ownerId &&
          mongoose.Types.ObjectId.isValid(ownerId.ownerId)
        ) {
          // If already {ownerId: "..."}
          validatedProjectOwners.push({
            ownerId: new mongoose.Types.ObjectId(ownerId.ownerId),
          });
        } else {
          // Optionally throw error for invalid ownerId format here, or skip.
          // For now, skipping invalid ones.
          console.warn(
            `Skipping invalid project owner ID format: ${JSON.stringify(ownerId)} during project creation.`
          );
        }
      });
    }

    let projectBanners = [];
    if (files?.projectBanner?.length > 0) {
      if (files.projectBanner.length > 10) {
        throw new ApiError(400, "You can upload up to 10 banners.");
      }
      const uploadFile = async (file) => {
        if (file.size > 5 * 1024 * 1024) {
          console.warn(`File too large, skipped: ${file.originalname}`);
          return null;
        }
        try {
          const uniqueFileName = `${uuidv4()}-${file.originalname.replace(/\s+/g, "_")}`;
          const uploadedImageUrl = await uploadToS3(
            file.buffer,
            uniqueFileName,
            file.mimetype
          );
          return uploadedImageUrl
            ? { url: uploadedImageUrl, uploadDate: new Date() }
            : null;
        } catch (uploadError) {
          console.error(
            `Upload failed for ${file.originalname}:`,
            uploadError.message
          );
          return null;
        }
      };

      const batchSize = 3;
      for (let i = 0; i < files.projectBanner.length; i += batchSize) {
        const batch = files.projectBanner.slice(i, i + batchSize);
        const uploadedBatch = await Promise.allSettled(batch.map(uploadFile));
        projectBanners.push(
          ...uploadedBatch
            .filter((result) => result.status === "fulfilled" && result.value)
            .map((result) => result.value)
        );
      }
    }

    const projectData = {
      projectName,
      projectOwners: validatedProjectOwners,
      description,
      businessAreas,
      comapanyName,
      location,
      status: status || "Pending",
      deadline: validatedDeadline,
      physicalEducationRange,
      financialEducationRange,
      daysLeft: daysLeft || null, // Ensure daysLeft is null if not provided or handled
      projectBanner: projectBanners,
      createdBy: performingUser?._id,
      logs: [
        {
          actionType: "Project Creation",
          message: `Project "${projectName}" created by ${performingUser?.userName || "system"}`,
          userId: performingUser?._id,
          timestamp: new Date(),
        },
      ],
    };

    const project = await editProject.create(projectData);

    if (project && validatedProjectOwners.length > 0) {
      const recipientUserIds = new Set(
        validatedProjectOwners.map((po) => po.ownerId.toString())
      );
      if (performingUser?._id) {
        recipientUserIds.add(performingUser._id.toString());
      }

      if (recipientUserIds.size > 0) {
        try {
          const usersForPush = await User.find({
            _id: {
              $in: Array.from(recipientUserIds).map(
                (id) => new mongoose.Types.ObjectId(id)
              ),
            },
            $or: [
              { fcmDeviceToken: { $ne: null, $exists: true, $ne: "" } },
              { notificationToken: { $ne: null, $exists: true, $ne: "" } },
            ],
          })
            .select("fcmDeviceToken notificationToken")
            .lean();

          const fcmTokens = usersForPush
            .map((u) => u.fcmDeviceToken || u.notificationToken)
            .filter(Boolean);

          if (fcmTokens.length > 0) {
            const pushTitle = `New Project Created: ${project.projectName}`;
            const pushBody = `A new project "${project.projectName}" has been created by ${performingUser?.userName || "system"}.`;
            await sendPushNotification(fcmTokens, pushTitle, pushBody, {
              projectId: project._id.toString(),
              type: "PROJECT_CREATED",
            });
          }
        } catch (pushError) {
          console.error(
            "Failed to send project creation push notifications:",
            pushError.message
          );
        }
      }
    }

    res
      .status(201)
      .json(new ApiResponse(201, project, "Project created successfully"));
  } catch (error) {
    console.error("Error in createProject (FULL ERROR OBJECT):", error);
    const statusCode =
      error instanceof ApiError
        ? error.statusCode
        : error.name === "ValidationError" || error.name === "CastError"
          ? 400
          : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : "An error occurred during project creation.";
    const errors =
      error instanceof ApiError
        ? error.errors
        : error.errors ||
          (error.name === "ValidationError" ? error.errors : []);
    res
      .status(statusCode)
      .json(new ApiResponse(statusCode, null, message, errors));
  }
});

const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, page, milestoneUserIds, search } = req.query; // Added search
    const {
      isMain,
      _id: loggedInUserId,
      assignedBusinessAreas = [],
    } = req.user;
    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];

    let baseFilter = {};
    if (status && validStatuses.includes(status)) {
      baseFilter.status = status;
    }
    if (search) {
      // Add search criteria
      const searchRegex = new RegExp(search, "i"); // Case-insensitive search
      baseFilter.$or = [
        { projectName: searchRegex },
        { description: searchRegex },
        { location: searchRegex },
        { comapanyName: searchRegex },
        // Add other fields you want to search by
      ];
    }

    const userBusinessAreas = assignedBusinessAreas
      .map((area) => area.businessArea)
      .filter(Boolean);

    let finalFilter = { ...baseFilter };
    if (!isMain) {
      const userAccessConditions = [
        { members: loggedInUserId },
        { "projectOwners.ownerId": loggedInUserId },
      ];
      if (userBusinessAreas.length > 0) {
        userAccessConditions.push({
          businessAreas: { $in: userBusinessAreas },
        });
      }
      // If baseFilter already has an $or (from search), combine them with $and
      if (finalFilter.$or && userAccessConditions.length > 0) {
        finalFilter = {
          $and: [{ $or: finalFilter.$or }, { $or: userAccessConditions }],
        };
      } else if (userAccessConditions.length > 0) {
        finalFilter.$or = userAccessConditions;
      }
    }

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
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

    if (pageNumber > 0) query = query.skip(skip).limit(pageSize);
    const projects = await query.lean();

    let filteredProjectsByMilestone = projects;
    if (milestoneUserIds) {
      try {
        const parsedMilestoneUserIds = JSON.parse(milestoneUserIds);
        if (
          Array.isArray(parsedMilestoneUserIds) &&
          parsedMilestoneUserIds.length > 0
        ) {
          const validUserIdsForMilestoneFilter = parsedMilestoneUserIds.filter(
            (id) => mongoose.Types.ObjectId.isValid(id)
          );
          if (validUserIdsForMilestoneFilter.length > 0) {
            const projectIds = projects.map((project) => project._id);
            const milestonesData = await AdditionalMilestone.find({
              projectId: { $in: projectIds },
              userId: { $in: validUserIdsForMilestoneFilter },
            })
              .select("projectId")
              .lean();
            const projectsWithMatchingMilestones = new Set(
              milestonesData.map((m) => m.projectId.toString())
            );
            filteredProjectsByMilestone = projects.filter((p) =>
              projectsWithMatchingMilestones.has(p._id.toString())
            );
          }
        }
      } catch (parseError) {
        console.warn(
          "Error parsing milestoneUserIds, skipping milestone filter:",
          parseError.message
        );
      }
    }

    const projectsWithDetails = filteredProjectsByMilestone.map((project) => {
      const isMember =
        project.members?.some((member) => member._id.equals(loggedInUserId)) ||
        false;
      const isOwner =
        project.projectOwners?.some(
          (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
        ) || false;
      const projectBAs = Array.isArray(project.businessAreas)
        ? project.businessAreas
        : project.businessAreas
          ? [project.businessAreas]
          : [];
      const fromBusinessArea =
        !isMember &&
        !isOwner &&
        projectBAs.some((area) => userBusinessAreas.includes(area));
      return {
        ...project,
        accessType: { isMember, isOwner, fromBusinessArea },
      };
    });

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
    console.error("Error in getAllProjects (FULL ERROR OBJECT):", error);
    throw new ApiError(
      error.statusCode || 500,
      error.message || "Failed to retrieve projects"
    );
  }
});

const getProjectById = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      isMain,
      _id: loggedInUserId,
      assignedBusinessAreas = [],
    } = req.user;

    if (!mongoose.Types.ObjectId.isValid(projectId))
      throw new ApiError(400, "Invalid Project ID format");

    const project = await editProject
      .findById(projectId)
      .populate([
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
      ])
      .lean();

    if (!project) throw new ApiError(404, "Project not found");

    if (!isMain) {
      const isMember =
        project.members?.some((member) => member._id.equals(loggedInUserId)) ||
        false;
      const isOwner =
        project.projectOwners?.some(
          (owner) => owner.ownerId && owner.ownerId._id.equals(loggedInUserId)
        ) || false;
      const projectBAs = Array.isArray(project.businessAreas)
        ? project.businessAreas
        : project.businessAreas
          ? [project.businessAreas]
          : [];
      const userBAs = assignedBusinessAreas
        .map((ba) => ba.businessArea)
        .filter(Boolean);
      const businessAreaMatch = projectBAs.some((pba) => userBAs.includes(pba));
      if (!isMember && !isOwner && !businessAreaMatch) {
        throw new ApiError(
          403,
          "You don't have permission to access this project."
        );
      }
    }

    const currentMilestones = [
      { name: "Project Details", completed: true, key: "details" },
      { name: "Filling", completed: false, key: "filling" },
      { name: "Payment", completed: false, key: "payment" },
      { name: "Review", completed: false, key: "review" },
      { name: "Completed", completed: false, key: "project_completed" },
    ];

    const isFillingComplete =
      project.description &&
      project.location &&
      project.projectName &&
      project.projectBanner?.length > 0 &&
      project.members?.length > 0;
    if (isFillingComplete)
      (currentMilestones.find((m) => m.key === "filling") || {}).completed =
        true;

    const [
      projectUserDocs,
      projectSystemDocs,
      projectFinanceDocs,
      projectAdditionalMilestones,
    ] = await Promise.all([
      UserDocument.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      Document.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      FinanceDocument.find({ projName: project.projectName })
        .sort({ uploadedAt: -1 })
        .lean(),
      AdditionalMilestone.find({ projectId: project._id })
        .populate({ path: "userId", model: "User", select: "userName" })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    if (projectFinanceDocs.length > 0)
      (currentMilestones.find((m) => m.key === "payment") || {}).completed =
        true;
    if (
      (currentMilestones.find((m) => m.key === "filling") || {}).completed &&
      (currentMilestones.find((m) => m.key === "payment") || {}).completed
    ) {
      (currentMilestones.find((m) => m.key === "review") || {}).completed =
        true;
    }
    if (project.status === "Completed")
      (
        currentMilestones.find((m) => m.key === "project_completed") || {}
      ).completed = true;

    const responseData = {
      ...project,
      members:
        project.members?.map((member) => ({
          userId: member._id,
          _id: member._id,
          userName: member.userName,
          avatar: member.avatar,
          userType: member.userType || "N/A",
          role: member.role?.roleName || "N/A",
        })) || [],
      projectOwners:
        project.projectOwners
          ?.filter((owner) => owner.ownerId)
          .map((owner) => ({
            ownerId: owner.ownerId._id,
            ownerName: owner.ownerId.userName || "",
            role: owner.ownerId.role?.roleName || "N/A",
            _id: owner.ownerId._id,
            email: owner.ownerId.email || "",
          })) || [],
      documents: projectUserDocs.map((doc) => ({
        ...doc,
        id: doc._id,
        uploadedAt: doc.uploadedAt || doc.createdAt,
      })),
      financeDocuments: projectFinanceDocs.map((doc) => ({
        ...doc,
        id: doc._id,
      })),
      projectReports: projectSystemDocs.map((report) => ({
        ...report,
        id: report._id,
        uploadedAt: report.uploadedAt || report.createdAt,
      })),
      latestLog:
        project.logs?.sort(
          (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
        )[0] || null,
      milestones: currentMilestones,
      additionalMilestones: projectAdditionalMilestones,
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseData, "Project retrieved successfully")
      );
  } catch (error) {
    console.error("Error in getProjectById (FULL ERROR OBJECT):", error);
    throw new ApiError(
      error.statusCode || 500,
      error.message || "Failed to retrieve project details"
    );
  }
});

const deleteProject = asyncHandler(async (req, res) => {
  const { projectId } = req.params;
  const performingUser = req.user;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    throw new ApiError(400, "Invalid Project ID format.");
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const projectToDelete = await editProject
      .findById(projectId)
      .populate(
        "projectOwners.ownerId",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .populate(
        "members",
        "email userName _id notificationToken fcmDeviceToken"
      )
      .session(session)
      .lean();

    if (!projectToDelete) {
      throw new ApiError(404, "Project not found.");
    }

    const deletedProjectName = projectToDelete.projectName;
    const deletedProjectId = projectToDelete._id;

    await editProject.findByIdAndDelete(projectId, { session });
    // Cascading deletes for related documents
    await UserDocument.deleteMany(
      { projName: deletedProjectName },
      { session }
    );
    await Document.deleteMany({ projName: deletedProjectName }, { session });
    await FinanceDocument.deleteMany(
      { projName: deletedProjectName },
      { session }
    );
    await AdditionalMilestone.deleteMany(
      { projectId: deletedProjectId },
      { session }
    );

    const notificationRecipients = new Map();
    (projectToDelete.members || []).forEach(
      (user) =>
        user?._id && notificationRecipients.set(user._id.toString(), user)
    );
    (projectToDelete.projectOwners || []).forEach(
      (ownerObj) =>
        ownerObj?.ownerId?._id &&
        notificationRecipients.set(
          ownerObj.ownerId._id.toString(),
          ownerObj.ownerId
        )
    );
    if (
      performingUser?._id &&
      !notificationRecipients.has(performingUser._id.toString())
    ) {
      const performerDetails = await User.findById(performingUser._id)
        .select("email userName notificationToken fcmDeviceToken")
        .lean(); // Fetch outside session or before delete
      if (performerDetails)
        notificationRecipients.set(
          performerDetails._id.toString(),
          performerDetails
        );
    }
    const usersToNotify = Array.from(notificationRecipients.values());

    if (usersToNotify.length > 0) {
      const inAppNotificationsToCreate = usersToNotify.map((user) => ({
        title: `Project Deleted: ${deletedProjectName}`,
        type: "Project Deletion",
        description: `Project "${deletedProjectName}" was deleted by ${performingUser.userName}.`,
        memberId: user._id,
        projectId: deletedProjectId,
      }));
      if (inAppNotificationsToCreate.length > 0) {
        await ShowNotification.create(inAppNotificationsToCreate, {
          session,
          ordered: true,
        });
      }
    }

    await session.commitTransaction();

    if (usersToNotify.length > 0) {
      const fcmTokens = usersToNotify
        .map((u) => u.fcmDeviceToken || u.notificationToken)
        .filter(Boolean);
      if (fcmTokens.length > 0) {
        const pushTitle = `Project Deleted: ${deletedProjectName}`;
        const pushBody = `The project "${deletedProjectName}" was deleted by ${performingUser.userName}.`;
        try {
          await sendPushNotification(fcmTokens, pushTitle, pushBody, {
            deletedProjectId: deletedProjectId.toString(),
            type: "PROJECT_DELETED",
          });
        } catch (pushError) {
          console.error(
            `Failed to send project deletion push notifications for project ${deletedProjectId}:`,
            pushError.message
          );
        }
      }
    }

    res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { deletedProjectId, projectName: deletedProjectName },
          "Project deleted successfully."
        )
      );
  } catch (error) {
    await session.abortTransaction();
    console.error("Error deleting project (FULL ERROR OBJECT):", error);
    const statusCode = error instanceof ApiError ? error.statusCode : 500;
    const message =
      error instanceof ApiError
        ? error.message
        : "An error occurred while deleting the project.";
    res
      .status(statusCode)
      .json(new ApiResponse(statusCode, null, message, error.errors || []));
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
