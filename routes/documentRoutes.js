import express from 'express';
import multer from 'multer';
import { uploadFile, getDocuments, updateStatus, deleteDocument } from '../controllers/documentController.js';
import { verifyJWT } from '../middlewares/auth.middleware.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Multer Error Handling Middleware
 */
const uploadErrorHandler = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ message: "Multer error", error: err.message });
    }
    next(err);
};

/**
 * Document Routes
 */
router.route('/')
    .post(verifyJWT, upload.single('file'), uploadErrorHandler, uploadFile) // Handle file uploads
    .get(verifyJWT, getDocuments); // Get all documents

router.route('/:id')
    .patch(verifyJWT, updateStatus) // Update document status
    .delete(verifyJWT, deleteDocument);

export default router;
