import { asyncHandler } from "../utils/asyncHandler.js";
import { User } from "../models/user.model.js";
import { Company } from "../models/CompanyModel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { generateRandomPassword } from "../utils/generatePassword.js";
import { SendEmailUtil } from "../utils/emailsender.js";
import { LanguagePreference } from "../models/languagePreferenceSchema.js";

const ALLOWED_USER_TYPES = ["Finance", "Production"];

const createClient = asyncHandler(async (req, res) => {
  try {
    const { ...clientData } = req.body;

    const languagePref = await LanguagePreference.findOne({
      userId: req.user._id,
    }).lean();
    const userLanguage = languagePref?.languageSelected || "portuguese";

    if (!ALLOWED_USER_TYPES.includes(clientData.userType)) {
      throw new ApiError(400, "Invalid userType.");
    }

    if (!clientData.companyName) {
      throw new ApiError(400, "Company name is required.");
    }

    const companyExists = await Company.findOne({
      name: clientData.companyName,
    });
    if (!companyExists) {
      throw new ApiError(400, "Company not found.");
    }

    const emailPresent = await User.findOne({ email: clientData.email });
    if (emailPresent) {
      throw new ApiError(400, "Email already exists");
    }

    const createdBy = await User.findById(req.user._id);
    const generatedPassword = generateRandomPassword();

    const userData = {
      ...clientData,
      password: generatedPassword,
      createdBy: {
        userName: createdBy?.userName,
        userId: req.user._id,
      },
      isClient: true,
      status: "Active",
      firstLogin: true,
    };

    const newUser = await User.create(userData);

    try {
      const userName = clientData.userName || "User";
      const subject =
        userLanguage === "portuguese"
          ? "A sua conta foi criada com sucesso"
          : "Welcome to the Soapro platform!";

      const html =
        userLanguage === "portuguese"
          ? `
        <!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><title>Credenciais da Conta</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;">
        <h2 style="color: #333;">A sua conta foi criada com sucesso</h2>
        <p style="font-size: 16px; color: #555;">Olá <strong>${userName}</strong>,</p>
        <p style="font-size: 16px; color: #555;">Informamos que a sua conta foi criada com sucesso na nossa plataforma MySOAPRO.</p>
        <p style="font-size: 16px; color: #555;">Dados de acesso:</p>
        <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="font-size: 16px; color: #555; margin: 5px 0;"><strong>Email:</strong> ${clientData.email}</p>
            <p style="font-size: 16px; color: #555; margin: 5px 0;"><strong>Palavra-passe temporária:</strong> <span style="font-weight: bold; color: #007bff;">${generatedPassword}</span></p>
        </div>
        <p style="font-size: 14px; color: #555;">Por favor, altere a sua palavra-passe após o primeiro acesso para garantir a proteção da sua conta.</p>
        <p style="font-size: 14px; color: #555;">Se não reconhece esta criação de conta, contacte de imediato a nossa equipa de suporte.</p>
        <p style="font-size: 14px; color: #555;">Obrigado por confiar em nós.</p>
        <p style="font-size: 14px; color: #999; margin-top: 30px;"><strong>Equipa SOAPRO</strong></p>
        </td></tr></table></body></html>
      `
          : `
        <!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Account Credentials</title></head><body style="font-family: Arial, sans-serif; background-color: #f9f9f9; padding: 20px;"><table width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff; max-width: 600px; margin: auto; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1);"><tr><td style="padding: 20px; text-align: left;">
        <h2 style="color: #333;">Your Account Has Been Created</h2>
        <p style="font-size: 16px; color: #555;">Hello <strong>${userName}</strong>,</p>
        <p style="font-size: 16px; color: #555;">Your account has been successfully created on our platform. Below are your login credentials:</p>
        <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p style="font-size: 16px; color: #555; margin: 5px 0;"><strong>Email:</strong> ${clientData.email}</p>
            <p style="font-size: 16px; color: #555; margin: 5px 0;"><strong>Password:</strong> <span style="font-weight: bold; color: #007bff;">${generatedPassword}</span></p>
        </div>
        <p style="font-size: 16px; color: #555;">For security reasons, we strongly recommend that you change your password after your first login.</p>
        <p style="font-size: 14px; color: #999; margin-top: 30px;">Best regards,<br><strong>The Soapro Team</strong></p>
        </td></tr></table></body></html>
      `;

      await SendEmailUtil({
        from: process.env.EMAIL_FROM || "app@soapro.ao",
        to: clientData.email,
        subject,
        html,
      });
    } catch (emailError) {}

    const userToReturn = newUser.toObject();
    userToReturn.generatedPassword = generatedPassword;
    delete userToReturn.password;

    res
      .status(201)
      .json(
        new ApiResponse(
          201,
          userToReturn,
          "New customer created and email sent successfully!"
        )
      );
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      500,
      error.message || "An internal error occurred while creating the client."
    );
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