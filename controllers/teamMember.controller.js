import { asyncHandler } from "../utils/asyncHandler.js";
import { teamMember } from "../models/teamMember.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadToS3 } from "../utils/cloudinary.js";

// Create a new teamMember
const createteamMember = asyncHandler(async (req, res) => {
  try {
    const userId = req.user._id;
    const { body, files } = req;
    console.log("🚀 ~ createteamMember ~ files:", files)

    // Handle avatar upload
    let avatarLocalPath;
    if (files && Array.isArray(files.avatar) && files.avatar.length > 0) {
      avatarLocalPath = files.avatar[0];
    }

    console.log("🚀 ~ createteamMember ~ avatar:", avatarLocalPath)
    let avatar;
    if (avatarLocalPath) {
      avatar =  await uploadToS3(files.avatar[0].buffer, files.avatar[0].originalname, files.avatar[0].mimetype);;
      if (!avatar) {
        throw new ApiError(400, "Failed to upload avatar image", [], { avatar: "Failed to upload avatar image" });
      }
    }
    
    // Create team member with avatar
    const teamMemberData = {
      ...body,
      user: userId,
      avatar: avatar ? avatar : undefined,
    };

    const newTeamMember = await teamMember.create(teamMemberData); // Avoid name conflict with the model

    res.status(201).json(new ApiResponse(201, newTeamMember, "Team member created successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});
  

const getAllteamMembers = asyncHandler(async (req, res) => {
  const teamMembers = await teamMember.find().sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, teamMembers, "All teamMembers fetched successfully"));
});

// Get single teamMember by ID for the logged-in user
const getteamMemberById = asyncHandler(async (req, res) => {
    // Extract user ID from cookies
    const userId = req.user._id;

    // Find the teamMember by ID associated with the user ID
    const teamMember = await teamMember.findOne({ _id: req.params.id, user: userId });

    if (!teamMember) {
        throw new ApiError(404, "teamMember not found");
    }

    res.status(200).json(new ApiResponse(200, teamMember, "teamMember found"));
});

// Update teamMember by ID for the logged-in user
const updateteamMemberById = asyncHandler(async (req, res) => {
    // Extract user ID from cookies
    const userId = req.user._id;

    // Find and update the teamMember by ID associated with the user ID
    const teamMemberData = await teamMember.findOneAndUpdate({ _id: req.params.id, user: userId }, req.body, {
        new: true,
        runValidators: true,
    });

    if (!teamMemberData) {
        throw new ApiError(404, "teamMember not found");
    }

    res.status(200).json(new ApiResponse(200, teamMemberData, "teamMember updated successfully"));
});

// Delete teamMember by ID for the logged-in user
const deleteteamMemberById = asyncHandler(async (req, res) => {
    // Extract user ID from cookies
    const userId = req.user._id;

    const teamMember = await teamMember.findOneAndDelete({ _id: req.params.id, user: userId });

    if (!teamMember) {
        throw new ApiError(404, "teamMember not found");
    }

    res.status(200).json(new ApiResponse(200, {}, "teamMember deleted successfully"));
});

export {
    createteamMember,
    getAllteamMembers,
    getteamMemberById,
    updateteamMemberById,
    deleteteamMemberById,
};
