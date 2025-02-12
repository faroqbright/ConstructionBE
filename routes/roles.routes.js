import express from "express";
import {
  createRole,
  getAllRoles,
  getRoleById,
  updateRoleById,
  deleteRoleById,
  getAllRolesWithLabel
} from "../controllers/role.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

// Routes for Role
router
  .route("/")
  .post(verifyJWT, createRole) // Create a new role
  .get(verifyJWT, getAllRoles) // Get all roles
   // Get all roles
   router
   .route("/dropdown")
   .get(verifyJWT, getAllRolesWithLabel);
router
  .route("/:id")
  .get(verifyJWT, getRoleById) // Get a role by ID
  .put(verifyJWT, updateRoleById) // Update a role by ID
  .delete(verifyJWT, deleteRoleById); // Delete a role by ID

export default router;
