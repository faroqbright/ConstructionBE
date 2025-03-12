import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";
import UserDocument from "../models/userdocumentModel.js";
import FinanceDocument from "../models/finance.model.js";
import mongoose from "mongoose";

const createProject = asyncHandler(async (req, res) => {
  try {
    const {
      projectName,
      projectOwners,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;

    const existingProject = await editProject.findOne({ projectName });
    if (existingProject) {
      throw new ApiError(
        400,
        "Project name already taken. Choose a different name."
      );
    }

    let projectBanners = [];

    if (files?.projectBanner?.length > 0) {
      if (files.projectBanner.length > 3) {
        throw new ApiError(400, "You can only upload up to 3 banners.");
      }

      for (const file of files.projectBanner) {
        if (file.size > 20 * 1024 * 1024) {
          // 20MB limit
          throw new ApiError(
            400,
            `File "${file.originalname}" exceeds the 20MB size limit.`
          );
        }

        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          file.originalname,
          file.mimetype
        );
        if (!uploadedImageUrl) continue;

        projectBanners.push({
          url: uploadedImageUrl,
          uploadDate: new Date(),
        });
      }
    }

    const projectData = {
      projectName,
      projectOwners,
      description,
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
    throw new ApiError(400, error.message);
  }
});

const editProjects = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      projectName,
      projectOwners,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      members,
      removeBanners = [],
    } = req.body;
    const { files } = req;

    const existingProject = await editProject.findById(projectId);
    if (!existingProject) {
      throw new ApiError(404, "Project not found");
    }

    // Ensure project name is not duplicated
    if (projectName && projectName !== existingProject.projectName) {
      const nameTaken = await editProject.findOne({ projectName });
      if (nameTaken) {
        throw new ApiError(
          400,
          "Project name already taken. Choose a different name."
        );
      }
    }

    let updateData = {};
    let logs = [];
    let updatedProjectBanners = existingProject.projectBanner || [];

    // Handle status updates
    if (existingProject.status !== status && status) {
      logs.push({
        actionType: "Status Update",
        message: `Status updated from "${existingProject.status}" to "${status}" by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    // Handle project name changes
    if (existingProject.projectName !== projectName && projectName) {
      logs.push({
        actionType: "Project Name Change",
        message: `Project name changed from "${existingProject.projectName}" to "${projectName}" by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    // Handle deadline changes
    if (existingProject.deadline !== deadline && deadline) {
      logs.push({
        actionType: "Deadline Change",
        message: `Deadline changed from "${existingProject.deadline}" to "${deadline}" by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    // Handle banner removal
    if (removeBanners.length > 0) {
      updatedProjectBanners = updatedProjectBanners.filter(
        (banner) => !removeBanners.includes(banner.url)
      );
      logs.push({
        actionType: "Project Banner Removal",
        message: `Removed ${removeBanners.length} banner(s) by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    // Handle new banners upload
    if (files?.projectBanner?.length > 0) {
      if (updatedProjectBanners.length + files.projectBanner.length > 10) {
        throw new ApiError(400, "You can only have up to 10 banners.");
      }

      for (const file of files.projectBanner) {
        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          file.originalname,
          file.mimetype
        );
        if (!uploadedImageUrl) continue;

        updatedProjectBanners.push({
          url: uploadedImageUrl,
          uploadDate: new Date(),
        });
      }

      logs.push({
        actionType: "Project Banner Addition",
        message: `Added ${files.projectBanner.length} new banner(s) by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    if (updatedProjectBanners.length > 10) {
      throw new ApiError(400, "You can only have a maximum of 10 banners.");
    }

    updateData = {
      ...updateData,
      projectName,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      projectBanner: updatedProjectBanners,
      ...(members && { members }),
      ...(projectOwners && {
        projectOwners: projectOwners
          .filter(ownerId => ownerId)
          .map((ownerId) => ({
            ownerId: new mongoose.Types.ObjectId(ownerId),
          })),
      }),         
      logs: [...existingProject.logs, ...logs],
    };

    const updatedProject = await editProject.findByIdAndUpdate(
      projectId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedProject, "Project updated successfully")
      );
  } catch (error) {
    console.error("Error updating project:", error.message);
    throw new ApiError(400, error.message);
  }
});

const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, page } = req.query;
    const { isMain, _id: loggedInUserId } = req.user;

    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];

    // Build the filter object
    const filter = {
      ...(status && validStatuses.includes(status) ? { status } : {}),
      ...(!isMain
        ? {
            $or: [
              { members: loggedInUserId },
              { "projectOwners.ownerId": loggedInUserId },
            ],
          }
        : {}),
    };

    const pageNumber = page ? parseInt(page, 10) : null;
    const pageSize = 10;
    const skip = pageNumber ? (pageNumber - 1) * pageSize : 0;

    let query = editProject.find(filter).populate([
      {
        path: "members",
        select: "userName avatar role",
        populate: {
          path: "role",
          select: "roleName",
        },
      },
      {
        path: "projectOwners.ownerId",
        model: "User",
        select: "userName role",
        populate: { path: "role", select: "roleName" },
      },
    ]);

    // Sort projects by createdAt in descending order
    query = query.sort({ createdAt: -1 });

    if (pageNumber) {
      query = query.skip(skip).limit(pageSize);
    }

    const projects = await query;
    const totalProjects = pageNumber
      ? await editProject.countDocuments(filter)
      : null;

    const projectsWithDocuments = await Promise.all(
      projects.map(async (project) => {
        // Step 1: Project created, so "Project Details" is always true
        const milestones = [
          { name: "Project Details", completed: true },
          { name: "Filling", completed: false },
          { name: "Payment", completed: false },
          { name: "Review", completed: false },
          { name: "Completed", completed: false },
        ];

        // Step 2: Check if all required fields are filled (excluding finance documents)
        const isFillingComplete =
          project.description &&
          project.location &&
          project.projectName &&
          project.projectBanner.length > 0 &&
          project.members.length > 0;

        if (isFillingComplete) {
          milestones[1].completed = true;
        }

        const projectDocuments = await UserDocument.find({
          projName: project.projectName,
        });

        const financeDocuments = await FinanceDocument.find({
          projName: project.projectName,
        });

        if (financeDocuments.length > 0) {
          milestones[2].completed = true;
        }

        // Step 4: Review gets activated when "Filling" and "Payment" are both completed
        if (milestones[1].completed && milestones[2].completed) {
          milestones[3].completed = true;
        }

        // Step 5: Mark "Completed" when project status is "Completed"
        if (project.status === "Completed") {
          milestones[4].completed = true;
        }

        // Filter out projectOwners that don't have a valid ownerId
        const updatedProjectOwners = project.projectOwners
          .filter((owner) => owner.ownerId)
          .map((owner) => ({
            ownerId: owner.ownerId._id || owner.ownerId,
            ownerName: owner.ownerId.userName || owner.ownerName || "",
            _id: owner._id,
          }));

        const filteredDocuments = projectDocuments.map((doc) => ({
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
        }));

        const financeDetails = financeDocuments.map((doc) => ({
          id: doc._id,
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
          financialExecution: doc.financialExecution,
          physicalExecution: doc.physicalExecution,
        }));

        const latestLog =
          project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null;

        return {
          ...project.toObject(),
          projectOwners: updatedProjectOwners,
          documents: filteredDocuments,
          financeDocuments: financeDetails,
          latestLog,
          milestones, // Include milestones for each project
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

    // Step 1: Project created, so "Project Details" is always true
    const milestones = [
      { name: "Project Details", completed: true },
      { name: "Filling", completed: false },
      { name: "Payment", completed: false },
      { name: "Review", completed: false },
      { name: "Completed", completed: false },
    ];

    // Step 2: Check if all required fields are filled (excluding finance documents)
    const isFillingComplete =
      project.description &&
      project.location &&
      project.projectName &&
      project.projectBanner.length > 0 &&
      project.members.length > 0;

    if (isFillingComplete) {
      milestones[1].completed = true;
    }

    // Step 3: Check if finance documents are uploaded
    const projectDocuments = await UserDocument.find({ projName: project.projectName });
    const financeDocuments = await FinanceDocument.find({ projName: project.projectName });

    if (financeDocuments.length > 0) {
      milestones[2].completed = true;
    }

    // Step 4: Review gets activated when "Filling" and "Payment" are both completed
    if (milestones[1].completed && milestones[2].completed) {
      milestones[3].completed = true;
    }

    // Step 5: Mark "Completed" when project status is "Completed"
    if (project.status === "Completed") {
      milestones[4].completed = true;
    }

    const updatedMembers = project.members.map((member) => ({
      userId: member._id,
      userName: member.userName,
      avatar: member.avatar,
      userType: member.userType || "Not Assigned",
    }));

    const updatedProjectOwners = project.projectOwners
      .filter((owner) => owner.ownerId)
      .map((owner) => ({
        ownerId: owner.ownerId._id || owner.ownerId,
        ownerName: owner.ownerId.userName || owner.ownerName || owner.userName || "",
        role: owner.ownerId.role ? owner.ownerId.role.roleName : "No Role",
        _id: owner._id,
      }));

    const filteredDocuments = projectDocuments.map((doc) => ({
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      user: doc.user,
    }));

    const financeDetails = financeDocuments.map((doc) => ({
      id: doc._id,
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      user: doc.user,
      financialExecution: doc.financialExecution,
      physicalExecution: doc.physicalExecution,
      uploadedAt: doc.uploadedAt,
    }));

    const latestLog =
      project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null;

    // Construct response
    const responseData = {
      ...project.toObject(),
      members: updatedMembers,
      projectOwners: updatedProjectOwners,
      documents: filteredDocuments,
      financeDocuments: financeDetails,
      latestLog,
      milestones, // Add milestones to response
    };

    res.status(200).json(new ApiResponse(200, responseData, "Project retrieved successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const deleteProject = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await editProject.findByIdAndDelete(projectId);

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    res
      .status(200)
      .json(new ApiResponse(200, project, "Project deleted successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

export {
  createProject,
  editProjects,
  getAllProjects,
  getProjectById,
  deleteProject,
};
