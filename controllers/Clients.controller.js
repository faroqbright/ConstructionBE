import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Company } from "../models/CompanyModel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

const ALLOWED_USER_TYPES = ["Finance", "Production"];

const createClient = asyncHandler(async (req, res) => {
  try {
    const { body } = req;

    if (!ALLOWED_USER_TYPES.includes(body.userType)) {
      throw new ApiError(400, "Invalid userType.");
    }

    if (!body.companyName) {
      throw new ApiError(400, "Company name is required.");
    }

    const companyExists = await Company.findOne({ name: body.companyName });
    if (!companyExists) {
      throw new ApiError(400, "Company not found.");
    }

    const emailPresent = await User.findOne({ email: body.email });
    if (emailPresent) {
      throw new ApiError(400, "Email already exists.");
    }

    const createdBy = await User.findById(req.user._id);
    
    const userData = {
      ...body,
      createdBy: {
        userName: createdBy?.userName,
        userId: req.user._id,
      },
      isClient: true,
      status: "Active",
    };

    const userDataNew = await User.create(userData);

    res.status(201).json(new ApiResponse(201, userDataNew, "New User created successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const editClient = asyncHandler(async (req, res) => {
  try {
    const { body } = req;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found.");
    }

    if (body.userType && !ALLOWED_USER_TYPES.includes(body.userType)) {
      throw new ApiError(400, "Invalid userType.");
    }

    if (body.companyName) {
      const companyExists = await Company.findOne({ name: body.companyName });
      if (!companyExists) {
        throw new ApiError(400, "Company not found. Please enter a valid company name.");
      }
    }

    if (body.email && body.email !== user.email) {
      const emailPresent = await User.findOne({ email: body.email });
      if (emailPresent) {
        throw new ApiError(400, "Email already exists.");
      }
    }

    const updatedFields = {
      ...body,
      updatedBy: {
        userName: req.user.userName,
        userId: req.user._id,
      },
    };

    const updatedUser = await User.findByIdAndUpdate(userId, updatedFields, {
      new: true,
      runValidators: true,
    });

    res.status(200).json(new ApiResponse(200, updatedUser, "User updated successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getClientById = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id });

  if (!user) {
    throw new ApiError(404, "User not found.");
  }

  res.status(200).json(new ApiResponse(200, user, "User found."));
});

const getAllClients = asyncHandler(async (req, res) => {
  const Users = await User.find({ isMain: false, isClient: true });

  res.status(200).json(new ApiResponse(200, Users, "All Users fetched successfully"));
});

const deleteClientById = asyncHandler(async (req, res) => {
  const user = await User.findOneAndDelete({ _id: req.params.id });

  if (!user) {
    throw new ApiError(404, "User not found.");
  }

  res.status(200).json(new ApiResponse(200, {}, "User deleted successfully"));
});

export { createClient, getAllClients, getClientById, deleteClientById, editClient };
