import express from "express";
import multer from "multer";
import {
  uploadUserDocument,
  getUserDocuments,
  updateUserDocumentStatus,
  deleteUserDocument,
} from "../controllers/userdocumentController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { updateFcmToken } from "../controllers/user.controller.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Multer Error Handling Middleware
 */
const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ message: "Multer error", error: err.message });
  }
  next(err);
};

/**
 * User Document Routes
 */
router
  .route("/")
  .post(
    verifyJWT,
    upload.single("file"),
    uploadErrorHandler,
    uploadUserDocument
  ) // Handle file uploads
  .get(verifyJWT, getUserDocuments); // Get all user documents

router
  .route("/:id")
  .patch(
    verifyJWT,
    upload.single("file"),
    uploadErrorHandler,
    updateUserDocumentStatus
  ) // Now supports file uploads
  .delete(verifyJWT, deleteUserDocument);

  router.route('/update-fcm-token').post(verifyJWT, updateFcmToken);

export default router;
