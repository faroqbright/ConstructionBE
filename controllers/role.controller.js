import { asyncHandler } from "../utils/asyncHandler.js";
import { Role } from "../models/role.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { io } from "../index.js";

const createRole = asyncHandler(async (req, res) => {
  try {
    const { roleName, permissions, status } = req.body;

    const existingRole = await Role.findOne({ roleName });
    if (existingRole) {
      throw new ApiError(400, "Role already exists");
    }
    const createdBy = req.user._id;
    const roleData = {
      roleName,
      createdBy,
      "permissions": [
        {
            "module": "ProjectsManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
          "module": "MilestoneManagement",
          "create": false,
          "read": false,
          "update": false,
          "delete": false
      },
        {
            "module": "ReportsManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "ClientsManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "UsersManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "RolesManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "HistoryManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "EvaluationManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "FinanceManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "DocumentManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        },
        {
            "module": "CompanyManagement",
            "create": false,
            "read": false,
            "update": false,
            "delete": false
        }
    ],
      status: status || "Active", // Default to Active if not provided
    };

    const newRole = await Role.create(roleData);

    res.status(201).json(new ApiResponse(201, newRole, "Role created successfully"));
  } catch (error) {
    throw new ApiError(400, error.message);
  }
});

const getAllRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find().sort({ createdAt: -1 });
  res.status(200).json(new ApiResponse(200, roles, "All roles fetched successfully"));
});

const getAllRolesWithLabel = asyncHandler(async (req, res) => {
    const roles = await Role.find();
  
    const formattedRoles = roles.map(role => ({
      label: role._id,
      value: role.roleName,
    }));
  
    res.status(200).json(new ApiResponse(200, formattedRoles, "Roles formatted successfully"));
  });
  
// Get a single role by ID
const getRoleById = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);

  if (!role) {
    throw new ApiError(404, "Role not found");
  }

  res.status(200).json(new ApiResponse(200, role, "Role found"));
});

// Update a role by ID
const updateRoleById = asyncHandler(async (req, res) => {
  const { roleName, permissions, status } = req.body;
  console.log("🚀 ~ updateRoleById ~ roleName:", roleName)

  const updatedRole = await Role.findByIdAndUpdate(
    req.params.id,
    { roleName, permissions, status },
    { new: true, runValidators: true }
  );

  if (!updatedRole) {
    throw new ApiError(404, "Role not found");
  }
  
  io.emit('accessedUpdate', true);
  res.status(200).json(new ApiResponse(200, updatedRole, "Role updated successfully"));
});

// Delete a role by ID
const deleteRoleById = asyncHandler(async (req, res) => {
  const deletedRole = await Role.findByIdAndDelete(req.params.id);

  if (!deletedRole) {
    throw new ApiError(404, "Role not found");
  }

  res.status(200).json(new ApiResponse(200, {}, "Role deleted successfully"));
});

export {
  createRole,
  getAllRoles,
  getRoleById,
  updateRoleById,
  deleteRoleById,
  getAllRolesWithLabel
};
