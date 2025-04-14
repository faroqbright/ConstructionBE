import express from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import {
  createOrUpdateBusinessArea,
  getAllBusinessAreas,
  getSingleBusinessArea,
  updateBusinessArea,
  deleteBusinessArea,
} from "../controllers/businessAreaController.js";

const router = express.Router();

// Base route: /api/business-areas
router
  .route("/")
  .post(verifyJWT, createOrUpdateBusinessArea) // Create or Update by `businessArea` value
  .get(verifyJWT, getAllBusinessAreas);        // Fetch all business areas

router
  .route("/:id")
  .get(verifyJWT, getSingleBusinessArea)       // Fetch single business area by ID
  .patch(verifyJWT, updateBusinessArea)        // Update by ID
  .delete(verifyJWT, deleteBusinessArea);      // Delete by ID

export default router;
