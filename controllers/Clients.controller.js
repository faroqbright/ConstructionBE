import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Company } from "../models/CompanyModel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { generateRandomPassword } from "../utils/generatePassword.js";
import { SendEmailUtil } from "../utils/emailsender.js";

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
      throw new ApiError(400, "Email already exists");
    }

    const createdBy = await User.findById(req.user._id);

    // 1. Generate plain-text password
    const generatedPassword = generateRandomPassword(); // e.g., "abC123"

    // 2. Add password to user data
    const userData = {
      ...body,
      password: generatedPassword, // store plain password (you can hash later if needed)
      createdBy: {
        userName: createdBy?.userName,
        userId: req.user._id,
      },
      isClient: true,
      status: "Active",
      firstLogin: true, // so frontend can show password change popup
    };

    const userDataNew = await User.create(userData);

    // 3. Send password to client's email
    try {
      const subject = "Welcome to the platform!";
      const html = `
        <p>Hello ${body.userName || "Client"},</p>
        <p>Your account has been created successfully.</p>
        <p><strong>Email:</strong> ${body.email}</p>
        <p><strong>Password:</strong> ${generatedPassword}</p>
        <p>Please change your password after login for security.</p>
      `;

      await SendEmailUtil({
        from: process.env.EMAIL_FROM ||  "app@soapro.ao",
        to: body.email,
        subject,
        html,
      });

      console.log("Client email sent successfully");
    } catch (emailError) {
      console.error("Failed to send client email:", emailError);
      // Optionally log to your error monitoring tool
    }

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          userDataNew,
          "Client created and password emailed."
        )
      );
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
      throw new ApiError(404, "User not found");
    }

    if (body.userType && !ALLOWED_USER_TYPES.includes(body.userType)) {
      throw new ApiError(400, "Invalid userType.");
    }

    if (body.companyName) {
      const companyExists = await Company.findOne({ name: body.companyName });
      if (!companyExists) {
        throw new ApiError(
          400,
          "Company not found. Please enter a valid company name."
        );
      }
    }

    if (body.email && body.email !== user.email) {
      const emailPresent = await User.findOne({ email: body.email });
      if (emailPresent) {
        throw new ApiError(400, "Email already exists");
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

    res
      .status(200)
      .json(new ApiResponse(200, updatedUser, "User updated successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getClientById = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(new ApiResponse(200, user, "User found"));
});

const getAllClients = asyncHandler(async (req, res) => {
  const users = await User.find({ isMain: false, isClient: true });

  const companyNames = users.map((user) => user.companyName);

  const existingCompanies = await Company.find({ name: { $in: companyNames } });
  const validCompanyNames = new Set(
    existingCompanies.map((company) => company.name)
  );

  const validUsers = users.filter((user) =>
    validCompanyNames.has(user.companyName)
  );

  res
    .status(200)
    .json(new ApiResponse(200, validUsers, "All Users fetched successfully"));
});

const deleteClientById = asyncHandler(async (req, res) => {
  const user = await User.findOneAndDelete({ _id: req.params.id });

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  res.status(200).json(new ApiResponse(200, {}, "User deleted successfully"));
});

export {
  createClient,
  getAllClients,
  getClientById,
  deleteClientById,
  editClient,
};
