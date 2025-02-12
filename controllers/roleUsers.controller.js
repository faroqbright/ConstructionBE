import { asyncHandler } from "../utils/asyncHandler.js";
import { teamMember } from "../models/teamMember.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { User } from "../models/user.model.js";
import { Role } from "../models/role.model.js";

// Create a new teamMember
const createroleUser = asyncHandler(async (req, res) => {
  try {
    const { body } = req;

    // Check if roleName already exists
    const emailPresent = await User.findOne({ email:body.email });
    if (emailPresent) {
      throw new ApiError(400, "email already exists");
    }
        const existingRole = await Role.findOne({ _id:body?.role });
        if (!existingRole) {
          throw new ApiError(400, "Role does not exists");
        }
    const createdBy = await User.findOne(req.user._id);
    console.log("🚀 ~ createroleUser ~ req.user:", req.user)
    console.log("🚀 ~ createroleUser ~ createdBy:", createdBy)
    const userData = {
      ...body,
      createdBy:{userName:createdBy?.userName,
        userId:req.user._id
      },
    };

    const userDataNew = await User.create(userData); // Avoid name conflict with the model

    res.status(201).json(new ApiResponse(201, userDataNew, "New User created successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});
const editRoleUser = asyncHandler(async (req, res) => {
  try {
    const { body } = req;
    const userId = req.params.id;

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    // If email is being updated, check for duplicate
    if (body.email && body.email !== user.email) {
      const emailPresent = await User.findOne({ email: body.email });
      if (emailPresent) {
        throw new ApiError(400, "Email already exists");
      }
    }

    // If role is being updated, validate the new role
    if (body.role && body.role !== user.role.toString()) {
      const existingRole = await Role.findOne({ _id: body.role });
      if (!existingRole) {
        throw new ApiError(400, "Role does not exist");
      }
    }

    // Update user fields
    const updatedFields = {
      ...body,
      updatedBy: {
        userName: req.user.userName,
        userId: req.user._id,
      },
    };

    // Update the user document
    const updatedUser = await User.findByIdAndUpdate(userId, updatedFields, {
      new: true,
      runValidators: true,
    });

    res
      .status(200)
      .json(new ApiResponse(200, updatedUser, "User updated successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getroleUserById = asyncHandler(async (req, res) => {

  const user = await User.findOne({ _id: req.params.id }).populate("role");

  if (!user) {
      throw new ApiError(404, "user not found");
  }

  res.status(200).json(new ApiResponse(200, user, "user found"));
});

// Get all teamMembers for the logged-in user
const getAllroleUsers = asyncHandler(async (req, res) => {

    const Users = await User.find({isMain:false,isClient:false}).populate("role");

    res.status(200).json(new ApiResponse(200, Users, "All Users fetched successfully"));
});

// Get single teamMember by ID for the logged-in user




// Delete teamMember by ID for the logged-in user
const deleteroleUserById = asyncHandler(async (req, res) => {
    // Extract user ID from cookies

    const user = await User.findOneAndDelete({ _id: req.params.id });

    if (!user) {
        throw new ApiError(404, "user not found");
    }

    res.status(200).json(new ApiResponse(200, {}, "user deleted successfully"));
});

export {
    createroleUser,
    getAllroleUsers,
    getroleUserById,
    deleteroleUserById,
    editRoleUser
};
