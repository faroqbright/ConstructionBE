import { editProject } from "../models/project.model.js";
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

const editProjects = asyncHandler(async (req, res) => {
  try {
    const { projectId } = req.params;
    let {
      projectName,
      projectOwners,
      description,
      location,
      businessAreas,
      comapanyName,
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

    // Ensure project name is unique
    if (projectName && projectName !== existingProject.projectName) {
      let nameTaken = await editProject.findOne({ projectName });
      if (nameTaken) {
        const uniqueSuffix = uuidv4().split("-")[0]; // Generate a short unique string
        projectName = `${projectName}-${uniqueSuffix}`;
        console.warn(`Project name already taken, renaming to: ${projectName}`);
      }

      logs.push({
        actionType: "Project Name Change",
        message: `Project name changed from "${existingProject.projectName}" to "${projectName}" by ${req.user.userName}`,
        userId: req.user.id,
        timestamp: new Date(),
      });
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
        const uniqueFileName = `${uuidv4()}-${file.originalname}`;
        const uploadedImageUrl = await uploadToS3(
          file.buffer,
          uniqueFileName,
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
      businessAreas,
      comapanyName,
      deadline,
      physicalEducationRange,
      daysLeft,
      projectBanner: updatedProjectBanners,
      ...(members && { members }),
      ...(projectOwners && {
        projectOwners: projectOwners
          .filter((ownerId) => ownerId)
          .map((ownerId) => ({
            ownerId: new mongoose.Types.ObjectId(ownerId),
          })),
      }),
      logs: [...existingProject.logs, ...logs],
    };

    if (req.body.financeDocuments && req.body.financeDocuments.length > 0) {
      for (const docId of req.body.financeDocuments) {
        await FinanceDocument.findByIdAndUpdate(docId, {
          $set: { uploadedAt: new Date() },
        });
      }
    }

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
    res.status(500).json({ message: error.message || "Internal Server Error" });
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

    const baseFilter = {
      ...(status && validStatuses.includes(status) ? { status } : {}),
    };

    let finalFilter = baseFilter;
    if (!isMain) {
      const businessAreaProjects = await editProject.find(
        { businessAreas: businessArea },
        { _id: 1 }
      );
      const businessAreaProjectIds = businessAreaProjects.map((p) => p._id);

      finalFilter = {
        ...baseFilter,
        $and: [
          {
            $or: [
              { _id: { $in: businessAreaProjectIds } },
              { members: loggedInUserId },
              { "projectOwners.ownerId": loggedInUserId },
            ],
          },
        ],
      };
    }

    const pageNumber = page ? parseInt(page, 10) : null;
    const pageSize = 10;
    const skip = pageNumber ? (pageNumber - 1) * pageSize : 0;

    let query = editProject.find(finalFilter).populate([
      {
        path: "members",
        select: "userName avatar role email", // ✅ added email
        populate: {
          path: "role",
          select: "roleName",
        },
      },
      {
        path: "projectOwners.ownerId",
        model: "User",
        select: "userName role email", // ✅ added email
        populate: {
          path: "role",
          select: "roleName",
        },
      },
    ]);
    

    query = query.sort({ createdAt: -1 });

    if (pageNumber) {
      query = query.skip(skip).limit(pageSize);
    }

    const projects = await query;
    const totalProjects = pageNumber
      ? await editProject.countDocuments(finalFilter)
      : null;

    const projectsWithDocuments = await Promise.all(
      projects.map(async (project) => {
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
            ? project.businessAreas === businessArea
            : project.businessAreas?.includes(businessArea));

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

        const [projectReports, projectDocuments, financeDocuments] =
          await Promise.all([
            Document.find({ projName: project.projectName }),
            UserDocument.find({ projName: project.projectName }),
            FinanceDocument.find({ projName: project.projectName }),
          ]);

        if (financeDocuments?.length > 0) milestones[2].completed = true;
        if (milestones[1].completed && milestones[2].completed)
          milestones[3].completed = true;
        if (project.status === "Completed") milestones[4].completed = true;

        const updatedProjectOwners =
          project.projectOwners
            ?.filter((owner) => owner.ownerId)
            .map((owner) => ({
              ownerId: owner.ownerId?._id || owner.ownerId,
              ownerName: owner.ownerId?.userName || owner.ownerName || "",
              _id: owner._id,
              email: owner.email || owner.ownerId.email,
            })) || [];

        const filteredDocuments =
          projectDocuments?.map((doc) => ({
            fileName: doc.fileName,
            fileUrl: doc.fileUrl,
            user: doc.user,
          })) || [];

        const filteredReports =
          projectReports?.map((report) => ({
            fileName: report.fileName,
            fileUrl: report.fileUrl,
            user: report.user,
            status: report.status,
            uploadedAt: report.uploadedAt,
          })) || [];

        const financeDetails =
          financeDocuments
            ?.map((doc) => ({
              id: doc._id,
              fileName: doc.fileName,
              fileUrl: doc.fileUrl,
              user: doc.user,
              financialExecution: doc.financialExecution,
              physicalExecution: doc.physicalExecution,
              uploadedAt: doc.uploadedAt,
              reference: doc.reference,
            }))
            .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)) ||
          [];

        const latestLog =
          project.logs?.sort((a, b) => b.timestamp - a.timestamp)[0] || null;

        const additionalMilestones = await AdditionalMilestone.find({
          projectId: project._id,
        }).populate({
          path: "userId",
          model: "User",
          select: "userName",
        });

        const projectObj = {
          ...project.toObject(),
          projectOwners: updatedProjectOwners,
          documents: filteredDocuments,
          financeDocuments: financeDetails,
          projectReports: filteredReports,
          latestLog,
          milestones,
          additionalMilestones,
        };
        
        if (!isMain) {
          projectObj.fromBusinessArea = fromBusinessArea;
        }
        
        return projectObj;        
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
        email: owner.ownerId.email || owner.email
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
