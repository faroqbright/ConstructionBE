import express from "express";
import multer from "multer";
import {
  uploadFinanceDocument,
  getFinanceDocuments,
  updateFinanceDocument,
  deleteFinanceDocument,
} from "../controllers/finance.controller.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const uploadErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ message: "Multer error", error: err.message });
  }
  next(err);
};

router
  .route("/")
  .post(
    verifyJWT,
    upload.single("file"),
    uploadErrorHandler,
    uploadFinanceDocument
  )
  .get(verifyJWT, getFinanceDocuments);

router
  .route("/:id")
  .patch(
    verifyJWT,
    upload.single("file"),
    uploadErrorHandler,
    updateFinanceDocument
  )
  .delete(verifyJWT, deleteFinanceDocument);

export default router;
