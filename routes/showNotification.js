import { Router } from "express";
import {
  createNotification,
  getNotifications,
  getNotificationById,
  updateNotificationStatus,
  clearAllNotifications,
  getAllNotificationsForUser,
} from "../controllers/showNotificationController.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";

const router = Router();

router.use(verifyJWT);

router
  .route("/")
  // POST /api/v1/shownotifications - Create a new notification
  .post(createNotification)
  // GET /api/v1/shownotifications - Get notifications (filtered for the user)
  .get(getNotifications);

router
  .route("/:id")
  // GET /api/v1/shownotifications/:id - Get a specific notification by its ID
  .get(getNotificationById)
  // PATCH /api/v1/shownotifications/:id - Update the isRead status of a notification
  .patch(updateNotificationStatus);
router
  .route("/:memberId")
  // Delete /api/v1/shownotifications/:id - Delete the notification of the user in the DB.
  .delete(clearAllNotifications);

router
  .route("/user/:userId") // e.g., GET /api/v1/notifications/user/someMongoDbUserId
  .get(getAllNotificationsForUser);
export default router;
