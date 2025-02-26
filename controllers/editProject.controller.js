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
      projectOwnerId,
      projectOwner,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
    } = req.body;
    const { body, files } = req;
    console.log("🚀 ~ createProject ~ files:", files);

    // Handling project banner file upload
    let projectBannerLocalPath;
    // if (files && Array.isArray(files.projectBanner) && files.projectBanner.length > 0) {
    //   projectBannerLocalPath = files.projectBanner[0].path;
    //   console.log("🚀 ~ createProject ~ projectBannerLocalPath:", projectBannerLocalPath);
    // }
    if (
      files &&
      Array.isArray(files.projectBanner) &&
      files.projectBanner.length > 0
    ) {
      const projectBannerFile = files.projectBanner[0];

      // Assuming uploadToS3 expects a buffer, file name, and mimetype
      projectBannerLocalPath = await uploadToS3(
        projectBannerFile.buffer,
        projectBannerFile.originalname,
        projectBannerFile.mimetype
      );
    }

    let projectBanner;
    if (projectBannerLocalPath) {
      // Use S3 to upload the project banner image
      projectBanner = await uploadToS3(
        files.projectBanner[0].buffer,
        files.projectBanner[0].originalname,
        files.projectBanner[0].mimetype
      );
      console.log("🚀 ~ createProject ~ projectBanner:", projectBanner);

      if (!projectBanner) {
        throw new ApiError(400, "Failed to upload project banner image", [], {
          projectBanner: "Failed to upload project banner image",
        });
      }
    }

    // Prepare project creation data
    const projectData = {
      projectName,
      projectOwner,
      projectOwnerId,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      projectBanner: projectBanner ? projectBanner : undefined, // Save Cloudinary or S3 URL in database
    };

    // Create the project
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
      projectOwner,
      projectOwnerId,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      members,
    } = req.body;

    const { files } = req;

    // Validate members
    if (members && !Array.isArray(members)) {
      throw new ApiError(400, "Members must be an array of team member IDs");
    }

    // Optionally validate that each member ID exists in the database
    if (members && members.length > 0) {
      const validMembers = await User.find({ _id: { $in: members } });
      if (validMembers.length !== members.length) {
        throw new ApiError(400, "One or more member IDs are invalid");
      }
    }

    // Handle file upload for project banner
    let projectBannerLocalPath;
    if (
      files &&
      Array.isArray(files.projectBanner) &&
      files.projectBanner.length > 0
    ) {
      const projectBannerFile = files.projectBanner[0];
      projectBannerLocalPath = await uploadToS3(
        projectBannerFile.buffer,
        projectBannerFile.originalname,
        projectBannerFile.mimetype
      );
    }

    let projectBanner;
    if (projectBannerLocalPath) {
      projectBanner = await uploadToS3(
        files.projectBanner[0].buffer,
        files.projectBanner[0].originalname,
        files.projectBanner[0].mimetype
      );
      if (!projectBanner) {
        throw new ApiError(400, "Failed to upload project banner image", [], {
          projectBanner: "Failed to upload project banner image",
        });
      }
    }

    // Fetch the existing project before updating to track changes
    const existingProject = await editProject.findById(projectId);
    if (!existingProject) {
      throw new ApiError(404, "Project not found");
    }

    const updateData = {
      projectName,
      projectOwner,
      projectOwnerId,
      description,
      location,
      status,
      deadline,
      physicalEducationRange,
      daysLeft,
      ...(members && { members }),
      ...(projectBanner && { projectBanner }), // Save Cloudinary/S3 URL
    };

    // Track changes for logs
    const logs = [];
    const newUser = await User.find({ _id: req.user._id });
    console.log("🚀 ~ editProjects ~ newUser:", newUser);
    if (existingProject.status !== status && status) {
      const statusLogMessage = `Status updated from "${existingProject.status}" to "${status}" by  ${req.user.userName}`;
      logs.push({
        actionType: "Status Update",
        message: statusLogMessage,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    if (existingProject.projectName !== projectName && projectName) {
      const nameLogMessage = `Project name changed from "${existingProject.projectName}" to "${projectName}" by  ${req.user.userName}`;
      logs.push({
        actionType: "Project Name Change",
        message: nameLogMessage,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    if (existingProject.deadline !== deadline && deadline) {
      const deadlineLogMessage = `Deadline changed from "${existingProject.deadline}" to "${deadline}" by  ${req.user.userName}`;
      logs.push({
        actionType: "Deadline Change",
        message: deadlineLogMessage,
        userId: req.user.id,
        timestamp: new Date(),
      });
    }

    // Add logs to update data
    if (logs.length > 0) {
      updateData.logs = [...existingProject.logs, ...logs]; // Merge new logs with existing logs
    }

    // Update the project with the new data and logs
    const updatedProject = await editProject.findByIdAndUpdate(
      projectId,
      { ...updateData }, // Include updated data
      { new: true, runValidators: true }
    );

    res
      .status(200)
      .json(
        new ApiResponse(200, updatedProject, "Project updated successfully")
      );
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getAllProjects = asyncHandler(async (req, res) => {
  try {
    const { status, page = 1, projectOwnerId } = req.query; // Extract status and page number from query
    const validStatuses = [
      "Ongoing",
      "Pending",
      "Completed",
      "Awaiting Start",
      "On Hold",
      "Cancelled",
      "Archived",
    ];

    // Ensure the user is authenticated
    // const projectOwnerId = req?.user?._id;
    // console.log("🚀 ~ getAllProjects ~ projectOwnerId:", projectOwnerId)

    // if (!projectOwnerId) {
    //   throw new ApiError(401, "Unauthorized");
    // }

    // Build the filter object
    const filterByProjectOwnerId = {
      projectOwnerId, // Filter by the logged-in user's ID
      ...(status && validStatuses.includes(status) ? { status } : {}), // Add status filter if valid
    };
    const filter = {
      // Filter by the logged-in user's ID
      ...(status && validStatuses.includes(status) ? { status } : {}), // Add status filter if valid
    };

    // Pagination settings
    const pageSize = 10;
    const skip = (page - 1) * pageSize;

    // Fetch projects with filtering, pagination, and populate members
    const projects = await editProject
      .find(filter)
      .populate({
        path: "members",
        select: "userName avatar role",
        populate: {
          path: "role", // Populate the `role` field inside `members`
          select: "roleName", // Adjust to the specific fields you want from the `role` model
        },
      })
      // .populate("members", "userName avatar role") // Populate `name` and `avatar` from the `members` field
      .skip(skip)
      .limit(pageSize);

    // Total project count for pagination metadata
    const totalProjects = await editProject.countDocuments(
      projectOwnerId ? filterByProjectOwnerId : filter
    );

    res.status(200).json(
      new ApiResponse(
        200,
        {
          projects,
          currentPage: parseInt(page, 10),
          totalPages: Math.ceil(totalProjects / pageSize),
          totalProjects,
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

    const project = await editProject
      .findOne({ _id: projectId })
      .populate({
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
