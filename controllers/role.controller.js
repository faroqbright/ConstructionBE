import { asyncHandler } from "../utils/asyncHandler.js";
import { Role } from "../models/role.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { User } from "../models/user.model.js";
import { io } from "../index.js";

// Create a new role
const createRole = asyncHandler(async (req, res) => {
  console.log("Request Body:", req.body);
  console.log("User:", req.user);
  console.log("Created By:", createdBy);
    try {
    const { roleName, permissions, status } = req.body;

    // Check if roleName already exists
    const existingRole = await Role.findOne({ roleName });
    if (existingRole) {
      throw new ApiError(400, "Role already exists");
    }
    const createdBy = await User.findById(req.user._id);
    const roleData = {
      roleName,
      createdBy:createdBy?.userName,
      createdById:createdBy?._id,
      "permissions": [
        {
            "module": "ProjectsManagement",
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

// Get all roles
const getAllRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find();

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
