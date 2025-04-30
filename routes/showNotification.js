import { Router } from "express";
import {
    createNotification,
    getNotifications,
} from "../controllers/showNotificationController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js"; // Assuming you have this middleware

const router = Router();

// Apply authentication middleware to all notification routes
router.use(verifyJWT);

// --- Notification Routes ---

// POST /api/v1/notifications - Create a new notification
router.route("/").post(createNotification);

// GET /api/v1/notifications - Get notifications for the logged-in user (with filters/pagination)
router.route("/").get(getNotifications);


export default router;