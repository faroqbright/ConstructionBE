import { asyncHandler } from "../utils/asyncHandler.js";
import { Company } from "../models/CompanyModel.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";

// Create a new company
const createCompany = asyncHandler(async (req, res) => {
  try {
    const { name, email, number } = req.body;
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
  const companies = await Company.find();
  res.status(200).json(new ApiResponse(200, companies, "All companies fetched successfully"));
});

// Update company by ID
const updateCompanyById = asyncHandler(async (req, res) => {
  const updatedCompany = await Company.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!updatedCompany) {
    throw new ApiError(404, "Company not found");
  }
  res.status(200).json(new ApiResponse(200, updatedCompany, "Company updated successfully"));
});

// Delete company by ID
const deleteCompanyById = asyncHandler(async (req, res) => {
  const company = await Company.findByIdAndDelete(req.params.id);
  if (!company) {
    throw new ApiError(404, "Company not found");
  }
  res.status(200).json(new ApiResponse(200, {}, "Company deleted successfully"));
});

export { createCompany, getAllCompanies, updateCompanyById , deleteCompanyById };
