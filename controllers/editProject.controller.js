import { editProject } from "../models/project.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";
import { User } from "../models/user.model.js";
import UserDocument from "../models/userdocumentModel.js";
import FinanceDocument from "../models/finance.model.js";

const createProject = asyncHandler(async (req, res) => {
  try {
    const {
      projectName,
      projectOwners, // Now expects an array of owners [{ ownerId, ownerName }]
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
    } = req.body;
    const { files } = req;

    if (!Array.isArray(projectOwners) || projectOwners.length === 0) {
      throw new ApiError(400, "Project must have at least one owner.");
    }

    let projectBanners = [];

    if (files?.projectBanner?.length > 0) {
      if (files.projectBanner.length > 3) {
        throw new ApiError(400, "You can only upload up to 3 banners.");
      }

      for (const file of files.projectBanner) {
        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          file.originalname,
          file.mimetype
        );
        if (!uploadedImageUrl) continue;

        if (projectBanners.includes(uploadedImageUrl)) {
          throw new ApiError(400, "Duplicate banners are not allowed.");
        }

        projectBanners.push({
          url: uploadedImageUrl,
          uploadDate: new Date(), // Store upload timestamp
        });
      }
    }

    const projectData = {
      projectName,
      projectOwners, // Store as an array
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
      projectOwners, // Expecting an updated array of owners
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

    let updateData = {};
    let logs = [];
    let updatedProjectBanners = existingProject.projectBanner || [];

    // Handle project owners
    if (projectOwners && Array.isArray(projectOwners) && projectOwners.length > 0) {
      // Fetch owners' names from the User collection
      const ownersData = await User.find({ _id: { $in: projectOwners } }).select("userName");

      if (ownersData.length !== projectOwners.length) {
        const foundOwnerIds = ownersData.map((owner) => owner._id.toString());
        const missingOwners = projectOwners.filter((id) => !foundOwnerIds.includes(id));
        throw new ApiError(400, "Some owners were not found in the database.");
      }

      // Map owners to expected format
      updateData.projectOwners = ownersData.map((owner) => ({
        ownerId: owner._id,
        ownerName: owner.userName,
      }));
    }

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
        (url) => !removeBanners.includes(url)
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
      if (updatedProjectBanners.length + files.projectBanner.length > 3) {
        throw new ApiError(400, "You can only have up to 3 banners.");
      }

      for (const file of files.projectBanner) {
        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          file.originalname,
          file.mimetype
        );
        if (!uploadedImageUrl) continue;

        if (updatedProjectBanners.includes(uploadedImageUrl)) {
          throw new ApiError(400, "Duplicate banners are not allowed.");
        }

        updatedProjectBanners.push({
          url: uploadedImageUrl,
          uploadDate: new Date(),
        });
      }

      logs.push({
        actionType: "Project Banner Addition",
        message: `Added new banner(s) by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    if (updatedProjectBanners.length > 3) {
      throw new ApiError(400, "You can only have a maximum of 3 banners.");
    }

    // Final update object
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
      logs: [...existingProject.logs, ...logs],
    };

    const updatedProject = await editProject.findByIdAndUpdate(
      projectId,
      updateData,
      { new: true, runValidators: true }
    );

    res.status(200).json(
      new ApiResponse(200, updatedProject, "Project updated successfully")
    );
  } catch (error) {
    console.error("Error updating project:", error.message);
    throw new ApiError(400, error.message);
  }
});


const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, projectOwnerId } = req.query;
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
      ...(status && validStatuses.includes(status) ? { status } : {}), // Add status filter if valid
    };

    // Fetch all projects with filtering and populate members
    const projects = await editProject
      .find(filter)
      .populate({
        path: "members",
        select: "userName avatar role",
        populate: {
          path: "role",
          select: "roleName",
        },
      });

    // Fetch finance documents for each project
    const projectsWithDocuments = await Promise.all(
      projects.map(async (project) => {
        const projectDocuments = await UserDocument.find({
          projName: project.projectName,
        });

        const financeDocuments = await FinanceDocument.find({
          projName: project.projectName,
        });

        // Extract relevant fields from documents
        const filteredDocuments = projectDocuments.map((doc) => ({
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
        }));

        const financeDetails = financeDocuments.map((doc) => ({
          fileName: doc.fileName,
          fileUrl: doc.fileUrl,
          user: doc.user,
          financialExecution: doc.financialExecution,
          physicalExecution: doc.physicalExecution,
        }));

        // Sort logs by timestamp to get the most recent log entry
        const latestLog =
          project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null;

        return {
          ...project.toObject(),
          documents: filteredDocuments,
          financeDocuments: financeDetails,
          lastDelivered:
            "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
          older: [
            "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
            "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
          ],
          nextMilestone: "Deliver the final scope",
          latestLog,
        };
      })
    );

    res
      .status(200)
      .json(new ApiResponse(200, { projects: projectsWithDocuments }, "Projects retrieved successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getProjectById = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await editProject.findOne({ _id: projectId }).populate({
      path: "members",
      select: "userName avatar role",
      populate: {
        path: "role",
        select: "roleName",
      },
    });

    if (!project) {
      throw new ApiError(404, "Project not found");
    }

    // Fetch documents where projName matches the project's name
    const projectDocuments = await UserDocument.find({
      projName: project.projectName,
    });

    const financeDocuments = await FinanceDocument.find({
      projName: project.projectName,
    });

    const financeDetails = financeDocuments.map((doc) => ({
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      user: doc.user,
      financialExecution: doc.financialExecution,
      physicalExecution: doc.physicalExecution,
    }));

    // Extract only fileName and fileUrl
    const filteredDocuments = projectDocuments.map((doc) => ({
      fileName: doc.fileName,
      fileUrl: doc.fileUrl,
      user: doc.user,
    }));

    // Sort logs by timestamp to get the most recent log entry
    const latestLog = project.logs.sort((a, b) => b.timestamp - a.timestamp)[0];

    // Construct response with attached documents
    const responseData = {
      ...project.toObject(),
      documents: filteredDocuments,
      financeDocuments: financeDetails,
      lastDelivered:
        "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
      older: [
        "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
        "https://myinnercircleaws.s3.amazonaws.com/1730889894003_fitness-handbook.pdf",
      ],
      nextMilestone: "Deliver the final scope",
      latestLog,
    };

    res
      .status(200)
      .json(
        new ApiResponse(200, responseData, "Project retrieved successfully")
      );
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
