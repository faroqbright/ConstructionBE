import { asyncHandler } from "../utils/asyncHandler.js";
import { Company } from "../models/CompanyModel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";

// Create a new company
const createCompany = asyncHandler(async (req, res) => {
  try {
    const { name, email, number } = req.body;

    // Check if email already exists
    const existingCompany = await Company.findOne({ email });
    if (existingCompany) {
      throw new ApiError(400, "Email already exists");
    }
    const existingCompanyName = await Company.findOne({ name });
    if (existingCompanyName) {
      throw new ApiError(400, "Company Name already exists");
    }

    const newCompany = await Company.create({
      name,
      email,
      number,
      status: "active",
    });

    res.status(201).json(new ApiResponse(201, newCompany, "Company created successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

// Get all companies
const getAllCompanies = asyncHandler(async (req, res) => {
  const companies = await Company.find().sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, companies, "All companies fetched successfully"));
});

// Update company by ID
const updateCompanyById = asyncHandler(async (req, res) => {
  try {
    const { email } = req.body;
    
    // Check if email already exists in another company
    if (email) {
      const existingCompany = await Company.findOne({ email, _id: { $ne: req.params.id } });
      if (existingCompany) {
        throw new ApiError(400, "Email already exists");
      }
    }

    const updatedCompany = await Company.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!updatedCompany) {
      throw new ApiError(404, "Company not found");
    }
    res.status(200).json(new ApiResponse(200, updatedCompany, "Company updated successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

// Delete company by ID
const deleteCompanyById = asyncHandler(async (req, res) => {
  const company = await Company.findById(req.params.id);
  if (!company) {
    throw new ApiError(404, "Company not found");
  }

  // Remove companyName from clients associated with this company
  await User.updateMany(
    { companyName: company.name },
    { $unset: { companyName: "" } } // Remove the companyName field
  );

  // Delete the company
  await Company.findByIdAndDelete(req.params.id);

  res.status(200).json(new ApiResponse(200, {}, "Company and associated data updated successfully"));
});

export { createCompany, getAllCompanies, updateCompanyById, deleteCompanyById };
