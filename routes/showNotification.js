import { Router } from "express";
import {
    createNotification,
    getNotifications,
    getNotificationById,      // <-- Import the new function
    updateNotificationStatus, // <-- Import the new function
} from "../controllers/showNotificationController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js"; // Assuming you have this middleware

const router = Router();

// Apply authentication middleware to all notification routes
// Ensures that only logged-in users can access these endpoints
router.use(verifyJWT);

// --- Notification Routes ---

// Routes for the collection (/api/v1/notifications)
router.route("/")
    // POST /api/v1/notifications - Create a new notification
    .post(createNotification)
    // GET /api/v1/notifications - Get notifications (filtered for the user)
    .get(getNotifications);


// Routes for a specific notification by ID (/api/v1/notifications/:id)
router.route("/:id")
    // GET /api/v1/notifications/:id - Get a specific notification by its ID
    .get(getNotificationById)
    // PATCH /api/v1/notifications/:id - Update the isRead status of a notification
    .patch(updateNotificationStatus);


export default router;