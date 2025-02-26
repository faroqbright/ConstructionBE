import express from "express";
import {
  createCompany,
  getAllCompanies,
  updateCompanyById,
  deleteCompanyById,
} from "../controllers/CompanyController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();

/**
 * Multer Error Handling Middleware
 */
router
  .route("/")
  .post(verifyJWT, createCompany) // Handle file uploads
  .get(verifyJWT, getAllCompanies);

router
  .route("/:id")
  .patch(verifyJWT, updateCompanyById)
  .delete(verifyJWT, deleteCompanyById);

export default router;
