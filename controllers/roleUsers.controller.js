import { asyncHandler } from "../utils/asyncHandler.js";
import { teamMember } from "../models/teamMember.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { Role } from "../models/role.model.js";
import { generateRandomPassword } from "../utils/generatePassword.js";
import { SendEmailUtil } from "../utils/emailsender.js";

const createroleUser = asyncHandler(async (req, res) => {
  try {
    const { body } = req;

    const emailPresent = await User.findOne({ email: body.email });
    if (emailPresent) {
      throw new ApiError(400, "Email already exists");
    }

    const existingRole = await Role.findOne({ _id: body?.role });
    if (!existingRole) {
      throw new ApiError(400, "Role does not exist");
    }

    const generatedPassword = generateRandomPassword(); // simple password
    // NO bcrypt.hash used here

    const createdBy = await User.findOne(req.user._id);

    const userData = {
      ...body,
      password: generatedPassword, // storing as plain text
      firstLogin: true,
      createdBy: {
        userName: createdBy?.userName,
        userId: req.user._id,
      },
    };

    const userDataNew = await User.create(userData);

    try {
      const subject = "Your account has been created!";
      const html = `
        <p>Hello ${body.userName || "User"},</p>
        <p>Your account has been created successfully.</p>
        <p><strong>Email:</strong> ${body.email}</p>
        <p><strong>Password:</strong> ${generatedPassword}</p>
        <p>Please change your password after login.</p>
      `;

      const emailResponse = await SendEmailUtil({
        from: process.env.EMAIL_FROM || "app@soapro.ao",
        to: body.email,
        subject,
        html,
      });

      console.log("Email sent successfully:", emailResponse);
    } catch (emailError) {
      console.error("Failed to send email:", emailError);
    }

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          userDataNew,
          "New User created and email sent successfully"
        )
      );
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const editRoleUser = asyncHandler(async (req, res) => {
  try {
    const { body } = req;
    const userId = req.params.id;

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, "User not found");
    }

    if (body.email && body.email !== user.email) {
      const emailPresent = await User.findOne({ email: body.email });
      if (emailPresent) {
        throw new ApiError(400, "Email already exists");
      }
    }

    if (body.role && body.role !== user.role.toString()) {
      const existingRole = await Role.findOne({ _id: body.role });
      if (!existingRole) {
        throw new ApiError(400, "Role does not exist");
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

const getroleUserById = asyncHandler(async (req, res) => {
  const user = await User.findOne({ _id: req.params.id }).populate("role");
  if (!user) {
    throw new ApiError(404, "user not found");
  }
  res.status(200).json(new ApiResponse(200, user, "user found"));
});

const getAllroleUsers = asyncHandler(async (req, res) => {
  const Users = await User.find({ isMain: false, isClient: false })
    .populate("role")
    .sort({ createdAt: -1 });

  res
    .status(200)
    .json(new ApiResponse(200, Users, "All Users fetched successfully"));
});

const deleteroleUserById = asyncHandler(async (req, res) => {
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
  editRoleUser,
};
